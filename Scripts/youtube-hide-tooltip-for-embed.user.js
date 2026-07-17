// ==UserScript==
// @name			YouTube: Hide Title Tooltip for Embed
// @description		Removes video title popup when hovering over embedded video
// @version			1.2.0
// @namespace		Mugnum.Scripts.YouTube.HideEmbedTooltip
// @author			Mugnum
// @license			MIT License
// @icon			https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @downloadURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/youtube-hide-tooltip-for-embed.user.js
// @updateURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/youtube-hide-tooltip-for-embed.user.js
// @match			*://*/*
// @grant			none
// ==/UserScript==

(function () {
	"use strict";

	const YOUTUBE_EMBED_HOSTS = new Set([
		"www.youtube.com",
		"youtube.com",
		"www.youtube-nocookie.com",
		"youtube-nocookie.com"
	]);

	function isYouTubeEmbed(iframe) {
		try {
			const url = new URL(iframe.src, location.href);
			return YOUTUBE_EMBED_HOSTS.has(url.hostname) && url.pathname.startsWith("/embed/");
		} catch {
			return false;
		}
	}

	function cleanIframe(iframe) {
		if (!(iframe instanceof HTMLIFrameElement) || !isYouTubeEmbed(iframe)) {
			return;
		}

		iframe.removeAttribute("title");
		iframe.setAttribute("aria-label", "YouTube video player");
	}

	function cleanNode(node) {
		if (!(node instanceof Element)) {
			return;
		}

		if (node.matches("iframe")) {
			cleanIframe(node);
		}

		node.querySelectorAll("iframe").forEach(cleanIframe);
	}

	function startObserver() {
		const observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.type === "attributes") {
					cleanIframe(mutation.target);
					continue;
				}

				for (const node of mutation.addedNodes) {
					cleanNode(node);
				}
			}
		});

		observer.observe(document.documentElement, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["title", "src"]
		});

		cleanNode(document.documentElement);
	}

	if (document.documentElement) {
		startObserver();
	} else {
		document.addEventListener("DOMContentLoaded", startObserver, { once: true });
	}
})();
