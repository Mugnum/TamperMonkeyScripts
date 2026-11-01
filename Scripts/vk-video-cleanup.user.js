// ==UserScript==
// @name			VK: Video Playlist Cleanup
// @description		Deletes dead videos from VK playlists (deleted, private or DMCA'd)
// @version			1.3.0
// @namespace		Mugnum.Scripts.VkVideo.Cleanup
// @author			Mugnum
// @license			MIT License
// @icon			https://www.google.com/s2/favicons?sz=64&domain=vkvideo.ru
// @downloadURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/vk-video-cleanup.user.js
// @updateURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/vk-video-cleanup.user.js
// @match			https://vkvideo.ru/playlist/*
// @grant			GM_addStyle
// @grant			GM_xmlhttpRequest
// @grant			GM_notification
// @grant			window.focus
// @connect			api.vk.com
// @connect			www.googleapis.com
// @connect			ok.ru
// @run-at			document-idle
// @noframes
// ==/UserScript==

(function () {
	"use strict";

	// An update will wipe tokens. Be sure to save them before update.
	const VK_ACCESS_TOKEN = "vk1.a.<token>";	// Personalized VK login token. Don't share it with anyone.
	const YOUTUBE_API_KEY = "<api-key>";		// YouTube API key with basic permissions.
	const OK_REQUEST_DELAY_MS = 1400;			// OK.ru embedded videos scan delay (rate limiting).
	const DELETE_NOTIFY_AFTER_MS = 40_000;		// Notifies after a long deletion when this tab is hidden. 0 disables deletion notifications.
	const YOUTUBE_BATCH_SIZE = 50;
	const VK_BATCH_SIZE = 200;
	const DEBUG = false;

	const VK_API_VERSION = "5.199";
	const REQUEST_TIMEOUT_MS = 20_000;
	const REQUEST_DELAY_MS = 750;
	const RATE_LIMIT_DELAY_MS = 30_000;
	const MAX_RATE_LIMIT_RETRIES = 3;
	const DELETE_REQUEST_BATCH_SIZE = 20;
	const DELETE_BATCH_DELAY_MS = 5_000;
	const LOCK_NAME = "mugnum-vk-video-cleanup";
	const PANEL_SELECTOR = "[data-testid=\"video_playlist_side_block\"]";
	const BUTTON_CLASS = "tm-vk-video-cleanup-button";
	const NOTIFICATION_STORAGE_KEY = "tm-vk-video-cleanup-completion";
	const FOCUS_REQUEST_TIMEOUT_MS = 3000;
	const pendingFocusRequests = new Map();
	let coordinationChannel = null;
	let activeSession = null;

	class RequestTimeoutError extends Error {
		constructor(service) {
			super(`${service}: запрос не завершился за 20 секунд. Обработка остановлена.`);
			this.name = "RequestTimeoutError";
		}
	}

	function debugLog(event, details) {
		if (!DEBUG) {
			return;
		}
		// Log a snapshot that can be copied from DevTools, rather than a live object reference.
		let snapshot = JSON.stringify(details);
		for (const credential of [VK_ACCESS_TOKEN, YOUTUBE_API_KEY]) {
			if (credential) {
				snapshot = snapshot.replaceAll(credential, "[redacted]");
			}
		}
		console.info(`[VK Video Cleanup] ${event}: ${snapshot}`);
	}

	function debugSource(value) {
		if (!value) {
			return null;
		}
		const url = parseUrl(value);
		if (!url) {
			return { format: "Not an absolute HTTP(S) URL", valueType: typeof value };
		}

		// Retain source identity without exposing signed playback URLs or access keys.
		const query = new URLSearchParams();
		for (const name of ["v", "id", "oid", "video_id", "vid"]) {
			if (url.searchParams.has(name)) {
				query.set(name, url.searchParams.get(name));
			}
		}
		return {
			url: `${url.origin}${url.pathname}${query.size ? `?${query}` : ""}`,
			queryParameterNames: [...new Set(url.searchParams.keys())]
		};
	}

	function debugVideo(video, classification, action, reason) {
		if (!DEBUG) {
			return;
		}
		debugLog("Video", {
			id: video.id ?? null, ownerId: video.owner_id ?? null, title: video.title ?? null,
			platform: video.platform ?? null, classification: classification.type,
			youtubeId: classification.youtubeId ?? null, action, reason,
			okEmbed: classification.okUrl ?? null,
			player: debugSource(video.player), external: debugSource(video.files?.external),
			fileFields: Object.keys(video.files || {}), availableFields: Object.keys(video),
			deleted: video.deleted ?? null, isDeleted: video.is_deleted ?? null,
			isPrivate: video.is_private ?? null, contentRestricted: video.content_restricted ?? null,
			restrictionMessage: video.content_restricted_message ?? null,
			processing: video.processing ?? null, converting: video.converting ?? null,
			upcoming: video.upcoming ?? null, live: video.live ?? null
		});
	}

	function getPlaylist() {
		const match = location.pathname.match(/^\/playlist\/(-?\d+)_(\d+)\/?$/);
		if (!match) {
			return null;
		}

		const ownerId = Number(match[1]);
		const albumId = Number(match[2]);
		if (!Number.isSafeInteger(ownerId) || !ownerId || !Number.isSafeInteger(albumId) || albumId <= 0) {
			return null;
		}

		return { ownerId, albumId, key: `${ownerId}_${albumId}` };
	}

	function validateConfiguration() {
		if (!VK_ACCESS_TOKEN.trim() || /[<>\s]/.test(VK_ACCESS_TOKEN)) {
			throw new Error("Укажите действующий VK_ACCESS_TOKEN в начале скрипта.");
		}
		if (!YOUTUBE_API_KEY.trim() || /[<>\s]/.test(YOUTUBE_API_KEY)) {
			throw new Error("Укажите действующий YOUTUBE_API_KEY в начале скрипта.");
		}
		if (!Number.isInteger(VK_BATCH_SIZE) || VK_BATCH_SIZE < 1 || VK_BATCH_SIZE > 200 ||
			!Number.isInteger(YOUTUBE_BATCH_SIZE) || YOUTUBE_BATCH_SIZE < 1 || YOUTUBE_BATCH_SIZE > 50) {
			throw new Error("Размер пачки VK должен быть от 1 до 200, YouTube — от 1 до 50.");
		}
		if (!Number.isSafeInteger(OK_REQUEST_DELAY_MS) || OK_REQUEST_DELAY_MS < 0) {
			throw new Error("OK_REQUEST_DELAY_MS должен быть целым неотрицательным числом мс.");
		}
		if (!Number.isSafeInteger(DELETE_NOTIFY_AFTER_MS) || DELETE_NOTIFY_AFTER_MS < 0) {
			throw new Error("DELETE_NOTIFY_AFTER_MS должен быть целым неотрицательным числом мс.");
		}
	}

	function focusThisTab() {
		window.focus();
	}

	function openCoordinationChannel() {
		if (coordinationChannel) {
			return;
		}
		try {
			coordinationChannel = new BroadcastChannel(LOCK_NAME);
			coordinationChannel.onmessage = ({ data }) => {
				if (!data || typeof data.requestId !== "string") {
					return;
				}
				if (data.type === "focus-active" && activeSession?.ownsLock && !activeSession.controller.signal.aborted) {
					let focused = false;
					try {
						focusThisTab();
						focused = true;
					} catch {
						debugLog("Active tab could not be focused", {});
					}
					coordinationChannel.postMessage({ type: "focus-result", requestId: data.requestId, focused });
				} else if (data.type === "focus-result") {
					pendingFocusRequests.get(data.requestId)?.(data.focused === true);
				}
			};
		} catch {
			coordinationChannel = null;
			debugLog("Tab coordination unavailable", {});
		}
	}

	function closeCoordinationChannel() {
		coordinationChannel?.close();
		coordinationChannel = null;
		for (const finish of pendingFocusRequests.values()) {
			finish(false);
		}
	}

	function requestActiveProcessingFocus() {
		if (!coordinationChannel) {
			return Promise.resolve(false);
		}
		return new Promise(resolve => {
			const requestId = crypto.randomUUID();
			const finish = focused => {
				clearTimeout(timer);
				pendingFocusRequests.delete(requestId);
				resolve(focused);
			};
			const timer = setTimeout(() => finish(false), FOCUS_REQUEST_TIMEOUT_MS);
			pendingFocusRequests.set(requestId, finish);
			try {
				// Only the tab holding the Web Lock responds. No URLs or credentials cross the channel.
				coordinationChannel.postMessage({ type: "focus-active", requestId });
			} catch {
				finish(false);
			}
		});
	}

	function showCompletionNotification(text) {
		try {
			GM_notification({
				title: "Очистка плейлиста", text, timeout: 0, highlight: false,
				onclick: focusThisTab
			});
		} catch {
			debugLog("Notification unavailable", {});
		}
	}

	function notifyScanCompleted(session) {
		if (document.visibilityState === "hidden") {
			const count = session.candidates.length;
			showCompletionNotification(count ? `Нажмите, чтобы подтвердить удаление (${count}) видео.` : "Нет видео подлежащих удалению");
		}
	}

	function reloadAfterDeletion(session) {
		if (document.visibilityState === "hidden" && DELETE_NOTIFY_AFTER_MS > 0 && Date.now() - session.deletionStartedAt > DELETE_NOTIFY_AFTER_MS) {
			try {
				// Only the notice survives reload in this tab, never credentials or scan data.
				sessionStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify({ playlist: session.playlist.key, createdAt: Date.now() }));
			} catch {
				debugLog("Completion notice could not be saved for reload", {});
			}
		}
		session.ui.close();
		location.reload();
	}

	function restoreCompletionNotification() {
		try {
			const stored = sessionStorage.getItem(NOTIFICATION_STORAGE_KEY);
			sessionStorage.removeItem(NOTIFICATION_STORAGE_KEY);
			const notice = stored ? JSON.parse(stored) : null;
			const age = Date.now() - notice?.createdAt;
			if (DELETE_NOTIFY_AFTER_MS > 0 && document.visibilityState === "hidden" && notice?.playlist === getPlaylist()?.key && age >= 0 && age < 300_000) {
				showCompletionNotification("Удаление завершено.");
			}
		} catch {
			debugLog("Saved completion notice unavailable", {});
		}
	}

	function updateScanProgress(session) {
		const text = session.total === null ? "Чтение плейлиста..." : `Проверено видео: ${session.completed} из ${session.total}.`;
		session.ui.progress(text, session.completed, session.total);
	}

	function completeVideoCheck(session) {
		session.completed++;
		updateScanProgress(session);
	}

	function checkSession(session) {
		session.controller.signal.throwIfAborted();
		if (getPlaylist()?.key !== session.playlist.key) {
			session.controller.abort();
			session.controller.signal.throwIfAborted();
		}
	}

	function pause(milliseconds, session) {
		checkSession(session);
		return new Promise((resolve, reject) => {
			const signal = session.controller.signal;
			const cancel = () => {
				clearTimeout(timer);
				reject(signal.reason);
			};
			const timer = setTimeout(() => {
				signal.removeEventListener("abort", cancel);
				resolve();
			}, milliseconds);
			signal.addEventListener("abort", cancel, { once: true });
		});
	}

	async function paceRequest(service, isWrite, session) {
		checkSession(session);

		// Count mutating API calls independently of scan requests.
		if (isWrite && session.writeRequests > 0 && session.writeRequests % DELETE_REQUEST_BATCH_SIZE === 0) {
			session.ui.notice("Пауза между группами удалений: 5 секунд...");
			await pause(DELETE_BATCH_DELAY_MS, session);
			session.ui.notice("");
		}

		const delay = REQUEST_DELAY_MS - (Date.now() - (session.lastRequests[service] || 0));

		if (delay > 0) {
			await pause(delay, session);
		}

		checkSession(session);
		session.lastRequests[service] = Date.now();

		if (isWrite) {
			session.writeRequests++;
		}
	}

	function requestResource(details, service, session) {
		checkSession(session);
		return new Promise((resolve, reject) => {
			const signal = session.controller.signal;
			let request;
			let settled = false;
			const finish = (error, result) => {
				if (settled) {
					return;
				}

				settled = true;
				clearTimeout(timer);
				signal.removeEventListener("abort", cancel);

				if (error) {
					reject(error);
				} else {
					resolve(result);
				}
			};
			const cancel = () => {
				finish(signal.reason);
				request?.abort();
			};
			const timeout = () => {
				finish(new RequestTimeoutError(service));
				request?.abort();
			};

			const timer = setTimeout(timeout, REQUEST_TIMEOUT_MS);
			signal.addEventListener("abort", cancel, { once: true });

			try {
				request = GM_xmlhttpRequest({
					...details,
					anonymous: true,
					timeout: REQUEST_TIMEOUT_MS,
					onload: response => {
						finish(null, {
							status: response.status, headers: response.responseHeaders || "",
							text: response.responseText, finalUrl: response.finalUrl || details.url
						});
					},
					onerror: () => finish(new Error(`${service}: ошибка сети. Обработка остановлена.`)),
					ontimeout: timeout,
					onabort: () => finish(signal.reason || new Error(`${service}: запрос прерван.`))
				});
			} catch {
				finish(new Error(`${service}: не удалось отправить запрос через Tampermonkey.`));
			}
		});
	}

	async function requestJson(details, service, session) {
		const response = await requestResource(details, service, session);
		let body = null;
		try {
			body = JSON.parse(response.text);
		} catch {
			// A rate limiter may return HTML instead of JSON.
		}
		return { status: response.status, headers: response.headers, body };
	}

	async function waitForRateLimit(service, response, attempt, session) {
		if (attempt >= MAX_RATE_LIMIT_RETRIES) {
			throw new Error(`${service}: лимит запросов сохраняется после трёх повторов. Обработка остановлена.`);
		}
		const retryAfter = response.headers.match(/^retry-after:\s*(.+)$/im)?.[1]?.trim();
		let delay = RATE_LIMIT_DELAY_MS;

		if (retryAfter) {
			const requestedDelay = /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();

			if (Number.isFinite(requestedDelay)) {
				delay = Math.max(delay, requestedDelay);
			}
		}
		session.ui.notice(`${service}: превышен лимит запросов. Пауза ${Math.ceil(delay / 1000)} сек., затем повтор...`);
		await pause(delay, session);
		session.ui.notice("");
	}

	async function callVk(method, parameters, session, isWrite = false) {
		for (let attempt = 0; ; attempt++) {
			await paceRequest("VK", isWrite, session);
			const data = new URLSearchParams({ ...parameters, access_token: VK_ACCESS_TOKEN, v: VK_API_VERSION });
			const response = await requestJson({
				method: "POST",
				url: `https://api.vk.com/method/${method}`,
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				data: data.toString()
			}, "VK", session);
			checkSession(session);
			const apiError = response.body?.error;
			const code = apiError?.error_code;

			if (apiError) {
				// request_params can contain the access token; log only our allowlisted identifiers.
				const safeParameters = Object.fromEntries(Object.entries(parameters).filter(([name]) => {
					return ["owner_id", "target_id", "video_id", "album_id", "count", "offset"].includes(name);
				}));
				debugLog("VK error", {
					method, code, subcode: apiError.error_subcode ?? apiError.subcode ?? null,
					message: apiError.error_msg ?? null, parameters: safeParameters
				});
			}
			if ([5, 27, 28].includes(code)) {
				throw new Error("Токен VK недействителен или истёк. Обновите VK_ACCESS_TOKEN. Обработка остановлена.");
			}
			if (response.status === 429 || [6, 9, 29].includes(code)) {
				await waitForRateLimit("VK", response, attempt, session);
				continue;
			}
			if (code === 14) {
				throw new Error("VK запросил капчу. Обработка остановлена; автоматический обход не выполняется.");
			}
			if (apiError) {
				const detail = code === 100 ? "Неверные или отсутствующие параметры запроса." :
					[7, 15, 204].includes(code) ? "Нет доступа к этому действию." : "Обработка остановлена.";
				throw new Error(`VK не выполнил ${method} (код ${code ?? "неизвестен"}). ${detail}`);
			}
			if (response.status < 200 || response.status >= 300 || !response.body ||
				typeof response.body !== "object" || !("response" in response.body)) {
				throw new Error(`VK: некорректный ответ на ${method} (HTTP ${response.status}). Обработка остановлена.`);
			}

			return response.body.response;
		}
	}

	async function callYoutube(ids, session) {
		let timeoutRetries = 0;
		let rateLimitRetries = 0;
		for (;;) {
			await paceRequest("YouTube", false, session);
			const query = new URLSearchParams({ part: "status", id: ids.join(",") });
			let response;
			try {
				response = await requestJson({
					method: "GET",
					url: `https://www.googleapis.com/youtube/v3/videos?${query}`,
					headers: { "x-goog-api-key": YOUTUBE_API_KEY }
				}, "YouTube", session);
			} catch (error) {
				checkSession(session);
				if (!(error instanceof RequestTimeoutError) || timeoutRetries >= 1) {
					throw error;
				}
				timeoutRetries++;
				debugLog("YouTube timeout retry", { ids, retry: timeoutRetries });
				session.ui.notice("YouTube не ответил. Повторная попытка...");
				continue;
			}
			checkSession(session);
			if (timeoutRetries) {
				session.ui.notice("");
			}
			const error = response.body?.error;
			const reasons = Array.isArray(error?.errors) ? error.errors.map(item => item.reason) : [];

			if (response.status === 429 || reasons.some(reason => ["rateLimitExceeded", "userRateLimitExceeded"].includes(reason))) {
				await waitForRateLimit("YouTube", response, rateLimitRetries++, session);
				continue;
			}
			if (error || response.status < 200 || response.status >= 300) {
				if ((Array.isArray(error?.details) && error.details.some(item => item.reason === "API_KEY_INVALID")) || reasons.includes("keyInvalid")) {
					throw new Error("Ключ YouTube недействителен. Обновите YOUTUBE_API_KEY. Обработка остановлена.");
				}
				if (reasons.some(reason => ["quotaExceeded", "dailyLimitExceeded"].includes(reason))) {
					throw new Error("Квота YouTube исчерпана. Обработка остановлена.");
				}
				throw new Error(`YouTube: ошибка API (HTTP ${response.status}). Проверьте ключ и его ограничения доступа.`);
			}
			if (response.body?.kind !== "youtube#videoListResponse" || !Array.isArray(response.body.items)) {
				throw new Error("YouTube вернул некорректный список видео. Обработка остановлена.");
			}

			return response.body.items;
		}
	}

	function parseUrl(value) {
		try {
			const url = new URL(value);
			return ["https:", "http:"].includes(url.protocol) ? url : null;
		} catch {
			return null;
		}
	}

	function getYoutubeId(value) {
		const url = parseUrl(value);

		if (!url) {
			return null;
		}

		const host = url.hostname.toLowerCase();
		let id = null;

		if (["youtu.be", "www.youtu.be"].includes(host)) {
			id = url.pathname.split("/")[1];
		} else if (["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com",
			"youtube-nocookie.com", "www.youtube-nocookie.com"].includes(host)) {
			id = url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.match(/^\/(?:embed|v|shorts|live)\/([^/]+)/)?.[1];
		}

		return /^[A-Za-z0-9_-]{11}$/.test(id || "") ? id : null;
	}

	function getOkEmbedUrl(value) {
		const url = parseUrl(value);

		if (!url || !["ok.ru", "www.ok.ru", "m.ok.ru"].includes(url.hostname) || url.username || url.password) {
			return null;
		}

		const match = url.pathname.match(/^\/videoembed\/(\d+)\/?$/);
		return match ? `https://ok.ru/videoembed/${match[1]}` : null;
	}

	function extractOkYoutubeId(html, embedUrl) {
		// Template contents stay inert: no scripts, images, iframes, or playback are loaded.
		const template = document.createElement("template");
		template.innerHTML = html;
		const players = template.content.querySelectorAll("[data-module=\"OKVideo\"][data-options]");

		if (players.length !== 1) {
			return { youtubeId: null, reason: "Expected exactly one OKVideo data-options element" };
		}

		let options;
		try {
			// The HTML parser has already decoded attribute entities.
			options = JSON.parse(players[0].getAttribute("data-options"));
		} catch {
			return { youtubeId: null, reason: "Invalid OKVideo data-options JSON" };
		}

		const metadata = options?.flashvars?.metadata;

		if (!metadata || typeof metadata !== "object" || metadata.provider !== "USER_YOUTUBE") {
			return { youtubeId: null, reason: "OK metadata provider is not USER_YOUTUBE or metadata is not an object" };
		}

		const movie = metadata.movie;

		if (movie?.id !== undefined && String(movie.id) !== embedUrl.split("/").pop()) {
			return { youtubeId: null, reason: "OK movie ID does not match the requested embed" };
		}

		if (typeof movie?.contentId !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(movie.contentId)) {
			return { youtubeId: null, reason: "Missing or invalid YouTube contentId in OK metadata" };
		}

		return { youtubeId: movie.contentId, reason: "OKVideo metadata contains a YouTube contentId" };
	}

	async function resolveOkYoutubeId(embedUrl, worker) {
		const session = worker.session;
		for (let attempt = 0; ; attempt++) {
			if (worker.requests > 0) {
				await pause(OK_REQUEST_DELAY_MS, session);
			}

			worker.requests++;
			const response = await requestResource({ method: "GET", url: embedUrl, redirect: "error" }, "OK.ru", session);
			checkSession(session);

			if (response.status === 429) {
				await waitForRateLimit("OK.ru", response, attempt, session);
				continue;
			}
			if (response.status < 200 || response.status >= 300) {
				throw new Error(`OK.ru: ошибка загрузки страницы (HTTP ${response.status}). Обработка остановлена.`);
			}
			if (response.finalUrl !== embedUrl) {
				throw new Error("OK.ru: получена другая страница вместо запрошенного embed. Обработка остановлена.");
			}

			const result = extractOkYoutubeId(response.text, embedUrl);
			debugLog("OK source", { embedUrl, ...result });
			return result;
		}
	}

	function classifyVideo(video) {
		const platform = String(video.platform || "").trim().toLowerCase();
		const external = video.files?.external;
		const okUrl = getOkEmbedUrl(external) || getOkEmbedUrl(video.player);

		if (okUrl) {
			return { type: "ok", okUrl };
		}
		const youtubeId = getYoutubeId(external) || getYoutubeId(video.player);
		if (platform === "youtube" || (!platform && youtubeId)) {
			return { type: "youtube", youtubeId };
		}
		if (platform && !["vk", "vkontakte"].includes(platform)) {
			return { type: "unsupported" };
		}
		if (external) {
			return { type: "unsupported" };
		}

		const player = parseUrl(video.player);
		const nativePlayer = player && ["vk.com", "www.vk.com", "vkvideo.ru", "www.vkvideo.ru"].includes(player.hostname);
		const nativeFiles = video.files && Object.keys(video.files).some(key => /^(mp4_|hls|dash)/.test(key));

		// Missing platform alone is not evidence that an external video is native.
		return { type: platform || nativePlayer || nativeFiles ? "native" : "unknown" };
	}

	function nativeRemovalReason(video) {
		if (video.processing || video.converting || video.upcoming || video.live) {
			return null;
		}
		if (video.deleted === 1 || video.deleted === true || video.is_deleted === 1 || video.is_deleted === true) {
			return "VK: видео удалено";
		}
		if (Number.isInteger(video.content_restricted) && video.content_restricted > 0) {
			return `VK: доступ ограничен (код ${video.content_restricted}). ${video.content_restricted_message || ""}`.trim();
		}

		// Private videos may still be accessible to their owner. Do not delete them just for being private.
		return null;
	}

	function youtubeRemovalReason(video) {
		if (!video) {
			return "YouTube: видео недоступно (удалено или скрыто)";
		}
		const status = video.status;
		if (!status || !["public", "unlisted", "private"].includes(status.privacyStatus) ||
			!["uploaded", "processed", "failed", "rejected", "deleted"].includes(status.uploadStatus)) {
			throw new Error("YouTube вернул неполный статус видео. Обработка остановлена.");
		}
		if (status.privacyStatus === "private") {
			return "YouTube: закрытое видео";
		}
		if (["deleted", "rejected", "failed"].includes(status.uploadStatus)) {
			return "YouTube: видео удалено, отклонено или не обработано";
		}

		// Regional restrictions and embeddable=false do not make a public video a deletion candidate.
		return null;
	}

	function skipVideo(video, reason, session, classification = { type: "unknown" }) {
		session.skipped++;
		debugVideo(video, classification, "skip", reason);
		completeVideoCheck(session);
	}

	async function inspectPage(videos, session, okWorker) {
		const youtubeVideos = [];
		for (const video of videos) {
			if (!video || !Number.isSafeInteger(video.id) || video.id <= 0 || !Number.isSafeInteger(video.owner_id) || !video.owner_id) {
				skipVideo(video || {}, "Missing video identity", session);
				continue;
			}

			const key = `${video.owner_id}_${video.id}`;

			if (session.seen.has(key)) {
				throw new Error("Состав плейлиста изменился во время чтения. Запустите проверку заново.");
			}

			session.seen.add(key);
			const classification = classifyVideo(video);

			if (classification.type === "ok") {
				debugVideo(video, classification, "queue-ok", "OK embed requires a separate source check");
				okWorker.enqueue({ video, okUrl: classification.okUrl });
			} else if (classification.type === "youtube" && classification.youtubeId) {
				debugVideo(video, classification, "check-youtube", "Direct YouTube ID found");
				youtubeVideos.push({ video, id: classification.youtubeId });
			} else if (classification.type === "native") {
				const reason = nativeRemovalReason(video);
				debugVideo(video, classification, reason ? "candidate" : "keep", reason || "No explicit VK removal condition");
				if (reason) {
					session.candidates.push({ video, reason });
				}
				completeVideoCheck(session);
			} else {
				const reason = classification.type === "youtube" ? "Missing YouTube ID" :
					classification.type === "unsupported" ? "Unsupported external platform" : "Unknown source";
				skipVideo(video, reason, session, classification);
			}
		}

		await inspectYoutubeVideos(youtubeVideos, session);
	}

	function inspectYoutubeVideos(videos, session) {
		if (!videos.length) {
			return Promise.resolve();
		}

		// Both scan paths share one serialized API queue and cache, never an OK page delay.
		const task = (session.youtubeTask || Promise.resolve()).then(() => inspectYoutubeBatch(videos, session));
		session.youtubeTask = task;
		void task.catch(() => {});
		return task;
	}

	async function inspectYoutubeBatch(videos, session) {
		checkSession(session);
		const grouped = new Map();
		for (const item of videos) {
			if (session.youtubeCache.has(item.id)) {
				completeYoutubeCheck(item, session);
			} else {
				if (!grouped.has(item.id)) {
					grouped.set(item.id, []);
				}
				grouped.get(item.id).push(item);
			}
		}
		const ids = [...grouped.keys()];
		for (let offset = 0; offset < ids.length; offset += YOUTUBE_BATCH_SIZE) {
			const batch = ids.slice(offset, offset + YOUTUBE_BATCH_SIZE);
			const items = await callYoutube(batch, session);
			const found = new Map();
			for (const item of items) {
				if (!item || !batch.includes(item.id) || found.has(item.id)) {
					throw new Error("YouTube вернул неожиданные идентификаторы видео. Обработка остановлена.");
				}

				found.set(item.id, item);
			}
			for (const id of batch) {
				const item = found.get(id);
				const reason = youtubeRemovalReason(item);
				session.youtubeCache.set(id, reason);
				debugLog("YouTube status", {
					id, found: found.has(id), privacyStatus: item?.status?.privacyStatus ?? null,
					uploadStatus: item?.status?.uploadStatus ?? null, embeddable: item?.status?.embeddable ?? null,
					action: reason ? "candidate" : "keep", reason
				});
			}
			for (const id of batch) {
				for (const item of grouped.get(id)) {
					completeYoutubeCheck(item, session);
				}
			}
		}
	}

	function completeYoutubeCheck(item, session) {
		const reason = session.youtubeCache.get(item.id);
		const classification = { type: item.okUrl ? "ok" : "youtube", youtubeId: item.id, okUrl: item.okUrl };
		debugVideo(item.video, classification, reason ? "candidate" : "keep", reason || "YouTube video is available");

		if (reason) {
			session.candidates.push({ video: item.video, reason });
		}
		if (item.okUrl) {
			session.okProcessed++;
		}

		completeVideoCheck(session);
	}

	class OkVideoWorker {
		constructor(session) {
			this.session = session;
			this.queue = [];
			this.youtubeTasks = [];
			this.cache = new Map();
			this.requests = 0;
			this.closed = false;
			this.wake = null;
			this.done = this.run();
		}

		enqueue(entry) {
			checkSession(this.session);
			this.queue.push(entry);
			this.session.okTotal++;
			this.updateProgress();
			this.wake?.();
		}

		close() {
			this.closed = true;
			this.wake?.();
		}

		async next() {
			while (!this.queue.length) {
				checkSession(this.session);

				if (this.closed) {
					return null;
				}

				await new Promise((resolve, reject) => {
					const signal = this.session.controller.signal;
					const cancel = () => {
						this.wake = null;
						reject(signal.reason);
					};
					this.wake = () => {
						signal.removeEventListener("abort", cancel);
						this.wake = null;
						resolve();
					};
					signal.addEventListener("abort", cancel, { once: true });
				});
			}
			checkSession(this.session);
			return this.queue.shift();
		}

		updateProgress() {
			const session = this.session;
			session.ui.okProgress(session.okResolved, session.okTotal, session.okResolved - session.okProcessed);
		}

		async run() {
			for (let entry = await this.next(); entry; entry = await this.next()) {
				if (!this.cache.has(entry.okUrl)) {
					this.cache.set(entry.okUrl, await resolveOkYoutubeId(entry.okUrl, this));
				}

				const result = this.cache.get(entry.okUrl);
				this.session.okResolved++;
				const classification = { type: "ok", okUrl: entry.okUrl, youtubeId: result.youtubeId };

				if (result.youtubeId) {
					debugVideo(entry.video, classification, "check-youtube", result.reason);

					// Check each resolved source promptly while the next OK fetch proceeds independently.
					const task = inspectYoutubeVideos([{ ...entry, id: result.youtubeId }], this.session).then(() => this.updateProgress());
					this.youtubeTasks.push(task);
					void task.catch(error => this.session.controller.abort(error));
				} else {
					skipVideo(entry.video, result.reason, this.session, classification);
					this.session.okProcessed++;
				}

				this.updateProgress();
			}
			await Promise.all(this.youtubeTasks);
			this.updateProgress();
		}

		clear() {
			this.queue.length = 0;
			this.youtubeTasks.length = 0;
			this.cache.clear();
		}
	}

	async function readPlaylist(session) {
		debugLog("Scan started", {
			playlist: session.playlist.key, vkBatchSize: VK_BATCH_SIZE,
			youtubeBatchSize: YOUTUBE_BATCH_SIZE, okRequestDelayMs: OK_REQUEST_DELAY_MS
		});
		session.ui.progress("Проверка токена VK и владельца плейлиста...");
		const users = await callVk("users.get", {}, session);
		const userId = users?.[0]?.id;

		if (!Number.isSafeInteger(userId) || userId <= 0) {
			throw new Error("Не удалось определить пользователя по токену VK. Нужен пользовательский токен.");
		}

		session.userId = userId;
		const album = await callVk("video.getAlbumById", { owner_id: session.playlist.ownerId, album_id: session.playlist.albumId }, session);

		if (session.playlist.ownerId !== userId || album?.owner_id !== userId) {
			throw new Error("Плейлист не принадлежит пользователю, указанному в токене VK. Обработка остановлена.");
		}
		if (album.id !== session.playlist.albumId || album.is_system) {
			throw new Error("VK вернул другой или системный плейлист. Обработка остановлена.");
		}

		session.okTotal = 0;
		session.okResolved = 0;
		session.okProcessed = 0;
		session.completed = 0;
		session.mainScanFinished = false;
		const okWorker = new OkVideoWorker(session);
		const main = scanVkPages(session, okWorker).finally(() => okWorker.close());
		try {
			await Promise.all([main, okWorker.done]);
		} catch (error) {
			// Stop and drain both paths before releasing the cross-tab lock or showing a result.
			session.controller.abort(error);
			await Promise.allSettled([main, okWorker.done]);
			await Promise.allSettled(okWorker.youtubeTasks);
			throw error;
		} finally {
			okWorker.clear();
			session.youtubeTask = null;
		}
		debugLog("Scan completed", {
			scanned: session.scanned, candidates: session.candidates.length, skipped: session.skipped,
			youtubeIdsChecked: session.youtubeCache.size, okQueued: session.okTotal, okProcessed: session.okProcessed
		});
	}

	async function scanVkPages(session, okWorker) {
		let offset = 0;
		do {
			updateScanProgress(session);
			const page = await callVk("video.get", {
				owner_id: session.userId, album_id: session.playlist.albumId,
				count: VK_BATCH_SIZE, offset, extended: 1
			}, session);
			debugLog("VK page", { offset, requested: VK_BATCH_SIZE, total: page?.count, received: page?.items?.length });

			if (!Number.isSafeInteger(page?.count) || page.count < 0 || !Array.isArray(page.items) || page.items.length > VK_BATCH_SIZE) {
				throw new Error("VK вернул некорректную страницу плейлиста. Обработка остановлена.");
			}
			if (session.total !== null && session.total !== page.count) {
				throw new Error("Количество видео в плейлисте изменилось. Запустите проверку заново.");
			}

			session.total = page.count;
			updateScanProgress(session);

			if ((!page.items.length && offset < page.count) || offset + page.items.length > page.count) {
				throw new Error("VK вернул неполный или несогласованный список видео. Удаление не начато.");
			}

			await inspectPage(page.items, session, okWorker);
			offset += page.items.length;
			session.scanned = offset;
		} while (offset < session.total);
		session.mainScanFinished = true;
		okWorker.updateProgress();
	}

	async function deleteSelected(selected, session) {
		checkSession(session);

		if (session.playlist.ownerId !== session.userId) {
			throw new Error("Владелец плейлиста не подтверждён. Удаление запрещено.");
		}

		session.deletionStarted = true;
		session.deletionStartedAt = Date.now();
		for (let index = 0; index < selected.length; index++) {
			checkSession(session);
			const { video } = selected[index];
			session.ui.progress(`Удаление: ${index} из ${selected.length}.`, index, selected.length);

			if (video.owner_id === session.userId) {
				const result = await callVk("video.delete", { owner_id: video.owner_id, video_id: video.id, target_id: session.userId }, session, true);

				if (result !== 1) {
					throw new Error("VK не подтвердил удаление собственного видео. Обработка остановлена.");
				}

				session.deletedOwned++;
				debugLog("VK write confirmed", { method: "video.delete", ownerId: video.owner_id, videoId: video.id });
			} else {
				const result = await callVk("video.removeFromAlbum", {
					target_id: session.userId, album_id: session.playlist.albumId,
					owner_id: video.owner_id, video_id: video.id
				}, session, true);

				if (result !== 1) {
					throw new Error("VK не подтвердил удаление видео из плейлиста. Обработка остановлена.");
				}

				session.removed++;
				debugLog("VK write confirmed", { method: "video.removeFromAlbum", ownerId: video.owner_id, videoId: video.id });
			}

			session.ui.progress(`Удаление: ${index + 1} из ${selected.length}.`, index + 1, selected.length);
		}
	}

	function resultCounts(session) {
		return `Удалено видео: ${session.deletedOwned + session.removed}.`;
	}

	async function withExclusiveLock(callback, onBusy, session) {
		if (!navigator.locks?.request) {
			throw new Error("Браузер не предоставляет блокировку вкладок. Обновите Chrome или Firefox и проверьте доступ к Web Locks.");
		}

		// All matching tabs share this origin and lock. Closing a tab releases it automatically.
		return navigator.locks.request(LOCK_NAME, { mode: "exclusive", ifAvailable: true }, async lock => {
			if (!lock) {
				onBusy();
				return;
			}
			session.ownsLock = true;
			try {
				return await callback();
			} finally {
				session.ownsLock = false;
			}
		});
	}

	async function runCleanup(session) {
		try {
			await withExclusiveLock(async () => {
				validateConfiguration();
				await readPlaylist(session);
				checkSession(session);

				if (!session.candidates.length) {
					session.ui.finish("Не найдено видео, подлежащих удалению");
					notifyScanCompleted(session);
					return;
				}

				notifyScanCompleted(session);
				const selected = await session.ui.review(session.candidates, session.controller.signal);
				checkSession(session);
				await deleteSelected(selected, session);
				reloadAfterDeletion(session);
			}, () => session.ui.showBusy(), session);
		} catch (error) {
			const cancelled = session.controller.signal.aborted && session.controller.signal.reason?.name === "AbortError";
			debugLog("Processing stopped", { cancelled, message: error.message, removed: session.removed, deletedOwned: session.deletedOwned });
			let message = cancelled ? "Обработка отменена." : error.message;

			if (session.deletionStarted) {
				message += ` ${resultCounts(session)} Уже выполненные удаления не отменяются. Последний отправленный запрос мог выполниться даже при обрыве связи или отмене.`;
			}

			session.ui.finish(message, !cancelled);
		} finally {
			session.controller.abort();
			session.candidates.length = 0;
			session.seen.clear();
			session.youtubeCache.clear();
			if (activeSession === session) {
				activeSession = null;
			}
		}
	}

	function createElement(tag, text, className) {
		const element = document.createElement(tag);

		if (text !== undefined) {
			element.textContent = text;
		}
		if (className) {
			element.className = className;
		}

		return element;
	}

	class CleanupDialog {
		constructor(controller) {
			this.controller = controller;
			this.dialog = createElement("dialog", undefined, "tm-vk-cleanup-dialog");
			const heading = createElement("h2", "Очистка плейлиста");
			heading.id = "tm-vk-cleanup-heading";
			this.dialog.setAttribute("aria-labelledby", heading.id);
			this.status = createElement("p", "Подготовка...");
			this.status.setAttribute("role", "status");
			this.bar = createElement("progress");
			this.bar.max = 1;
			this.bar.value = 0;
			this.bar.setAttribute("aria-label", "Прогресс обработки");
			this.notification = createElement("p", "", "tm-vk-cleanup-notice");
			this.notification.setAttribute("role", "status");
			this.workerStatus = createElement("p", "");
			this.workerStatus.setAttribute("role", "status");
			this.workerStatus.hidden = true;
			this.content = createElement("div", undefined, "tm-vk-cleanup-content");
			this.actions = createElement("div", undefined, "tm-vk-cleanup-actions");
			this.dialog.append(heading, this.status, this.bar, this.workerStatus, this.notification, this.content, this.actions);
			this.setActions([this.makeButton("Отмена", () => controller.abort())]);
			this.dialog.addEventListener("cancel", event => {
				event.preventDefault();

				if (this.finished) {
					this.close();
				} else {
					controller.abort();
				}
			});
			document.body.append(this.dialog);
			this.dialog.showModal();
		}

		makeButton(text, handler, danger = false) {
			const button = createElement("button", text, danger ? "tm-vk-cleanup-danger" : "");
			button.type = "button";
			button.addEventListener("click", handler);
			return button;
		}

		setActions(buttons) {
			this.actions.replaceChildren(...buttons);
		}

		progress(text, done = 0, total = null) {
			this.status.textContent = text;
			this.bar.hidden = false;

			this.bar.max = Math.max(1, total ?? 1);
			this.bar.value = total === null ? 0 : done;
		}

		notice(text) {
			this.notification.textContent = text;
		}

		okProgress(resolved, total, pendingYoutube) {
			this.workerStatus.hidden = total === 0;
			this.workerStatus.textContent = `Проверка OK.ru: ${resolved - pendingYoutube} из ${total}.`;
		}

		review(candidates, signal) {
			this.bar.hidden = true;
			this.workerStatus.hidden = true;
			this.notice("");
			this.status.textContent = `Видео подлежат удалению: ${candidates.length}.`;
			const table = createElement("table");
			const head = createElement("thead");
			const header = createElement("tr");
			header.append(createElement("th", "Удалить"), createElement("th", "Название видео"));
			head.append(header);
			const body = createElement("tbody");
			const rows = [];
			for (const candidate of candidates) {
				const row = createElement("tr");
				const selection = createElement("td");
				const checkbox = createElement("input");
				checkbox.type = "checkbox";
				checkbox.checked = true;
				const title = candidate.video.title || "Видео без названия";
				checkbox.setAttribute("aria-label", `Удалить: ${title}`);
				selection.append(checkbox);
				const description = createElement("td");
				description.append(createElement("span", title));
				row.append(selection, description);
				body.append(row);
				rows.push({ checkbox, candidate });
			}
			table.append(head, body);
			const scroll = createElement("div", undefined, "tm-vk-cleanup-table");
			scroll.append(table);
			this.content.replaceChildren(scroll);

			return new Promise((resolve, reject) => {
				const cancel = () => reject(signal.reason);
				signal.addEventListener("abort", cancel, { once: true });
				const remove = this.makeButton("Удалить", () => {
					const selected = rows.filter(row => row.checkbox.checked).map(row => row.candidate);

					if (!selected.length) {
						return;
					}

					signal.removeEventListener("abort", cancel);
					this.content.replaceChildren();
					this.setActions([this.makeButton("Отмена", () => this.controller.abort())]);
					resolve(selected);
				}, true);
				const update = () => {
					const count = rows.filter(row => row.checkbox.checked).length;
					remove.textContent = `Удалить (${count})`;
					remove.disabled = count === 0;
				};
				body.addEventListener("change", update);
				update();
				this.setActions([this.makeButton("Отмена", () => this.controller.abort()), remove]);
				remove.focus();
			});
		}

		finish(message, isError = false) {
			this.finished = true;
			this.workerStatus.hidden = true;
			this.status.textContent = message;
			this.status.setAttribute("role", isError ? "alert" : "status");
			this.bar.hidden = true;
			this.notice("");
			this.content.replaceChildren();
			const ok = this.makeButton("OK", () => this.close());
			this.setActions([ok]);
			ok.focus();
		}

		showBusy() {
			this.finish("Обработка уже запущена: ");
			const link = createElement("a", "перейти");
			link.href = "#";
			let pending = false;
			link.addEventListener("click", async event => {
				event.preventDefault();
				if (pending) {
					return;
				}
				pending = true;
				link.setAttribute("aria-busy", "true");
				const focused = await requestActiveProcessingFocus().catch(() => false);
				if (focused) {
					this.close();
				} else {
					this.finish("Не удалось перейти к активной обработке. Вернитесь к ней вручную.");
				}
			});
			this.status.append(link, ".");
		}

		close() {
			this.dialog.close();
			this.dialog.remove();
		}
	}

	function startCleanup() {
		if (activeSession) {
			activeSession.ui.dialog.focus();
			return;
		}

		const playlist = getPlaylist();

		if (!playlist) {
			return;
		}

		const controller = new AbortController();
		const ui = new CleanupDialog(controller);
		activeSession = {
			playlist, controller, ui, userId: null, ownsLock: false,
			candidates: [], seen: new Set(), youtubeCache: new Map(),
			total: null, scanned: 0, completed: 0, skipped: 0, removed: 0, deletedOwned: 0,
			writeRequests: 0, lastRequests: {}, deletionStarted: false
		};
		void runCleanup(activeSession);
	}

	function mountButtons() {
		if (activeSession && activeSession.playlist.key !== getPlaylist()?.key) {
			activeSession.controller.abort();
		}
		if (!getPlaylist()) {
			document.querySelectorAll(`.${BUTTON_CLASS}`).forEach(button => button.remove());
			return;
		}

		for (const panel of document.querySelectorAll(PANEL_SELECTOR)) {
			if (panel.querySelector(`.${BUTTON_CLASS}`)) {
				continue;
			}

			const template = panel.querySelector("[data-testid=\"play_playlist_video_button\"]");
			const group = template?.closest("[role=\"group\"]")?.parentElement;

			if (!template || !group || !panel.contains(group)) {
				continue;
			}

			// Reuse visual classes, but never copy event handlers, generated IDs, or the icon.
			const button = createElement("button", undefined, `${template.className} ${BUTTON_CLASS}`);
			button.type = "button";
			const inner = createElement("span", undefined, "vkuiButton__in");
			const label = createElement("span", "Удалить пустышки", "vkuiButton__content");
			inner.append(label);
			button.append(inner);
			button.addEventListener("click", startCleanup);
			group.append(button);
		}
	}

	function installStyles() {
		GM_addStyle(`
			button.${BUTTON_CLASS} { box-sizing: border-box; width: 177px; max-width: 100%; flex: 0 0 auto;
				align-self: flex-start; background-color: #fff !important; opacity: 1 !important; color: #000; cursor: pointer;
				box-shadow: 0 1px 4px #0002 !important; }
			.${BUTTON_CLASS} .vkuiButton__content { font-family: -apple-system, BlinkMacSystemFont, "Roboto", "Helvetica Neue", Arial, sans-serif;
				font-size: 14px; font-weight: 500; line-height: 20px; color: #000; white-space: nowrap; }
			dialog.tm-vk-cleanup-dialog { box-sizing: border-box; width: min(820px, calc(100vw - 32px));
				max-width: calc(100vw - 32px); max-height: calc(100dvh - 32px); min-width: 0; padding: clamp(16px, 3vw, 28px);
				overflow-x: hidden; overflow-y: auto; border: 1px solid #555; border-radius: 12px;
				background: #222; color: #eee; color-scheme: dark; font: 15px/1.5 Arial, sans-serif; }
			dialog.tm-vk-cleanup-dialog[open] { display: flex; flex-direction: column; }
			.tm-vk-cleanup-dialog *, .tm-vk-cleanup-dialog *::before, .tm-vk-cleanup-dialog *::after { box-sizing: border-box; min-width: 0; }
			.tm-vk-cleanup-dialog > * { max-width: 100%; flex-shrink: 0; }
			.tm-vk-cleanup-dialog::backdrop { background: #000a; }
			.tm-vk-cleanup-dialog h2 { margin: 0 0 16px; color: #eee !important; font-size: 21px; overflow-wrap: anywhere; }
			.tm-vk-cleanup-dialog p { white-space: pre-wrap; overflow-wrap: anywhere; }
			.tm-vk-cleanup-dialog a { color: #80baff; text-decoration: underline; }
			.tm-vk-cleanup-dialog progress { display: block; width: 100%; min-inline-size: 0; height: 22px; accent-color: #4799eb; }
			.tm-vk-cleanup-dialog [hidden] { display: none !important; }
			.tm-vk-cleanup-notice:empty { display: none; }
			.tm-vk-cleanup-notice { color: #ffd18a; }
			.tm-vk-cleanup-content { min-height: 0; flex-shrink: 1; overflow-x: hidden; overflow-y: auto; }
			.tm-vk-cleanup-table { max-height: 43vh; max-width: 100%; overflow-x: hidden; overflow-y: auto; }
			.tm-vk-cleanup-dialog table { width: 100%; border-collapse: collapse; table-layout: fixed; }
			.tm-vk-cleanup-dialog th, .tm-vk-cleanup-dialog td { padding: 10px; text-align: left; border-bottom: 1px solid #555;
				overflow-wrap: anywhere; white-space: normal; vertical-align: top; color: #eee; }
			.tm-vk-cleanup-dialog th { position: sticky; top: 0; background: #222; }
			.tm-vk-cleanup-dialog th:first-child { width: 64px; }
			.tm-vk-cleanup-dialog input[type="checkbox"] { width: 18px; height: 18px; accent-color: #4799eb; }
			.tm-vk-cleanup-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 12px; margin-top: 20px; }
			.tm-vk-cleanup-actions button { border: 1px solid #777; border-radius: 6px; padding: 8px 18px;
				background: #3c3c3c; color: white; font: inherit; cursor: pointer; }
			.tm-vk-cleanup-actions button.tm-vk-cleanup-danger { background: #b52d3b; border-color: #e06470; }
			.tm-vk-cleanup-actions button:disabled { opacity: .45; cursor: default; }
			.tm-vk-cleanup-actions button:focus-visible, .${BUTTON_CLASS}:focus-visible { outline: 2px solid #80baff; outline-offset: 2px; }
		`);
	}

	installStyles();
	openCoordinationChannel();
	restoreCompletionNotification();
	debugLog("Script initialized", { playlist: getPlaylist()?.key ?? null });
	mountButtons();
	let mountPending = false;
	const observer = new MutationObserver(() => {
		if (mountPending) {
			return;
		}

		mountPending = true;
		requestAnimationFrame(() => {
			mountPending = false;
			mountButtons();
		});
	});
	observer.observe(document.body, { childList: true, subtree: true });

	// The site changes playlists without reloading the document.
	let navigationTimer = setInterval(mountButtons, 1000);
	window.addEventListener("pagehide", () => {
		activeSession?.controller.abort();
		activeSession?.ui.close();
		closeCoordinationChannel();
		observer.disconnect();
		clearInterval(navigationTimer);
	});
	window.addEventListener("pageshow", event => {
		if (event.persisted) {
			openCoordinationChannel();
			observer.observe(document.body, { childList: true, subtree: true });
			navigationTimer = setInterval(mountButtons, 1000);
			mountButtons();
		}
	});
})();
