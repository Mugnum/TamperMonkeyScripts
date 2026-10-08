// ==UserScript==
// @name			Image Hosting: Auto Fullscreen
// @description		Automatically opens original images from supported image hosting preview pages
// @version			1.2.0
// @namespace		Mugnum.Scripts.ImageHosting.AutoFullscreen
// @author			Mugnum
// @license			MIT License
// @downloadURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/image-hosting-auto-fullscreen.user.js
// @updateURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/image-hosting-auto-fullscreen.user.js
// @match			https://fastpic.org/view/*
// @noframes
// @grant			none
// @run-at			document-start
// ==/UserScript==

(() => {
	"use strict";

	const WAIT_TIMEOUT_MS = 15_000;
	const RESOLVE_INTERVAL_MS = 3_500;
	const RESOLVE_QUEUE_KEY = "Mugnum.Scripts.ImageHosting.AutoFullscreen.ResolveQueue";
	// New hosts need both an @match entry and a handler factory.
	const HANDLER_FACTORIES = new Map([
		["fastpic.org", createFastPicHandler]
	]);

	function createHandler(pageUrl) {
		const factory = HANDLER_FACTORIES.get(pageUrl.hostname);
		return factory ? factory(pageUrl) : null;
	}

	function checkCurrentPage(pageUrl, signal) {
		signal.throwIfAborted();

		if (location.origin !== pageUrl.origin || location.pathname !== pageUrl.pathname) {
			throw new DOMException("The preview page was left.", "AbortError");
		}
	}

	function waitForDelay(delay, signal) {
		return new Promise((resolve, reject) => {
			signal.throwIfAborted();

			const timeout = setTimeout(() => {
				cleanup();
				resolve();
			}, delay);

			function cleanup() {
				clearTimeout(timeout);
				signal.removeEventListener("abort", cancel);
			}

			function cancel() {
				cleanup();
				reject(signal.reason);
			}

			signal.addEventListener("abort", cancel, { once: true });
		});
	}

	async function resolveAndOpenImage(handler, pageUrl, signal) {
		if (!navigator.locks?.request) {
			throw new Error("Web Locks are unavailable; leaving the preview open to avoid unthrottled requests.");
		}

		// Web Locks serialize tabs on the same hosting origin, including tabs in other windows.
		await navigator.locks.request(RESOLVE_QUEUE_KEY, { signal }, async () => {
			checkCurrentPage(pageUrl, signal);
			const lastResolvedAt = Number(localStorage.getItem(RESOLVE_QUEUE_KEY)) || 0;
			// Cap the wait if the system clock has moved backwards since the last resolution.
			const delay = Math.min(RESOLVE_INTERVAL_MS, Math.max(0, lastResolvedAt + RESOLVE_INTERVAL_MS - Date.now()));

			if (delay > 0) {
				await waitForDelay(delay, signal);
			}

			checkCurrentPage(pageUrl, signal);
			let url;

			// Keep a cooldown even if this document is destroyed before its finally block can run.
			localStorage.setItem(RESOLVE_QUEUE_KEY, String(Date.now()));

			try {
				url = await handler.resolveOriginalImageUrl(signal);
			} finally {
				// Persist before navigating so unloading this tab cannot erase the cooldown.
				// Failed resolutions also consume a turn, preventing a burst of fallback attempts.
				localStorage.setItem(RESOLVE_QUEUE_KEY, String(Date.now()));
			}

			checkCurrentPage(pageUrl, signal);
			location.replace(url.href);
		});
	}

	function waitForPageTarget(findTarget, signal) {
		return new Promise((resolve, reject) => {
			signal.throwIfAborted();

			const observer = new MutationObserver(check);
			const timeout = setTimeout(() => {
				cleanup();
				reject(new Error("Timed out waiting for an original image link."));
			}, WAIT_TIMEOUT_MS);

			function cleanup() {
				observer.disconnect();
				clearTimeout(timeout);
				document.removeEventListener("DOMContentLoaded", check);
				signal.removeEventListener("abort", cancel);
			}

			function cancel() {
				cleanup();
				reject(signal.reason);
			}

			function check() {
				if (signal.aborted) {
					return;
				}

				const target = findTarget();

				if (target) {
					cleanup();
					resolve(target);
				}
			}

			observer.observe(document, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ["href", "src"]
			});

			document.addEventListener("DOMContentLoaded", check, { once: true });
			signal.addEventListener("abort", cancel, { once: true });
			check();
		});
	}

	function createFastPicHandler(pageUrl) {
		const previewPath = pageUrl.pathname.match(/^\/view\/\d+\/\d{4}\/\d{4}\/([^/]+)\.html$/);

		if (!previewPath) {
			return null;
		}

		const filename = previewPath[1];
		const fullSizePath = pageUrl.pathname.replace("/view/", "/fullview/");

		function parseUrl(value) {
			if (!value) {
				return null;
			}

			try {
				return new URL(value, pageUrl.href);
			} catch {
				return null;
			}
		}

		function findOriginalImageUrl(root) {
			const candidates = root.querySelectorAll("#picContainer a[href], #temp a[href], #imglink img[src], #imga img[src]");

			for (const candidate of candidates) {
				const url = parseUrl(candidate.getAttribute("href") || candidate.getAttribute("src"));
				const expires = Number(url?.searchParams.get("expires"));

				if (!url || url.protocol !== "https:" || !/^i\d+\.fastpic\.org$/.test(url.hostname) ||
					!url.pathname.startsWith("/big/") || url.pathname.split("/").pop() !== filename ||
					!url.searchParams.get("md5") || !Number.isFinite(expires) || expires <= Date.now() / 1000) {
					continue;
				}

				// Keep FastPic's signature and expiration, but request browser viewing instead of downloading.
				url.searchParams.delete("dl");
				return url;
			}

			return null;
		}

		function findFullSizePageUrl() {
			for (const link of document.querySelectorAll("#picContainer a[href]")) {
				const url = parseUrl(link.getAttribute("href"));

				if (url?.origin === pageUrl.origin && url.pathname === fullSizePath) {
					return url;
				}
			}

			return null;
		}

		return {
			async resolveOriginalImageUrl(signal) {
				const target = await waitForPageTarget(() => {
					const original = findOriginalImageUrl(document);
					return original || (document.readyState !== "loading" ? findFullSizePageUrl() : null);
				}, signal);

				signal.throwIfAborted();

				if (target.origin !== pageUrl.origin) {
					return target;
				}

				// Request the site's full-size page only when the preview has no usable original link.
				const response = await fetch(target.href, {
					credentials: "same-origin",
					signal: AbortSignal.any([signal, AbortSignal.timeout(WAIT_TIMEOUT_MS)])
				});

				if (!response.ok) {
					throw new Error(`Could not load the full-size page (${response.status}).`);
				}

				const html = await response.text();
				signal.throwIfAborted();
				const fullSizePage = new DOMParser().parseFromString(html, "text/html");
				const original = findOriginalImageUrl(fullSizePage);

				if (!original) {
					throw new Error("The full-size page has no usable original image link.");
				}

				return original;
			}
		};
	}

	const pageUrl = new URL(location.href);
	const handler = createHandler(pageUrl);

	if (!handler) {
		return;
	}

	const controller = new AbortController();
	const cancelResolution = () => controller.abort();
	window.addEventListener("pagehide", cancelResolution, { once: true });

	resolveAndOpenImage(handler, pageUrl, controller.signal).catch(error => {
		if (error.name !== "AbortError") {
			console.warn("[Image Hosting Auto Fullscreen] Could not open the original image.", error);
		}
	}).finally(() => {
		window.removeEventListener("pagehide", cancelResolution);
	});
})();
