// ==UserScript==
// @name			Twitch: VOD Chat Offset
// @description		Adjust Twitch VOD chat replay offset
// @version			1.1.0
// @namespace		Mugnum.Scripts.Twitch.VodOffset
// @author			Mugnum
// @license			MIT License
// @icon			https://www.google.com/s2/favicons?sz=64&domain=twitch.tv
// @downloadURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/twitch-vod-chat-offset.user.js
// @updateURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/twitch-vod-chat-offset.user.js
// @match			https://www.twitch.tv/videos/*
// @match			https://www.twitch.tv/*/v/*
// @run-at			document-start
// @grant    	    none
// ==/UserScript==

(() => {
	"use strict";

	/**
	 * Instructions:
	 * Use `twitchVodChatOffset.set(-20)` in console and reload page to apply offset to current video.
	 * Will apply only to that VOD, saved value will persist across multiple VODs until another explicit `set` is called.
	 */

	let chatOffsetSeconds = 0;
	let activeVideoID = null;

	const STORAGE_KEY = "Mugnum.TwitchVodChatOffset.lastVideoOffset";
	const OPERATION_NAME = "VideoCommentsByOffsetOrCursor";
	const originalFetch = window.fetch;

	function readSavedOffset() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);

			if (!raw) {
				return null;
			}

			const parsed = JSON.parse(raw);

			if (parsed &&
					typeof parsed.videoID === "string" &&
					typeof parsed.offset === "number" &&
					Number.isFinite(parsed.offset)) {
				return parsed;
			}
		}
		catch { }

		return null;
	}

	function saveOffsetForVideo(videoID, offset) {
		if (!videoID || !Number.isFinite(offset)) {
			return;
		}

		if (offset === 0) {
			localStorage.removeItem(STORAGE_KEY);
			return;
		}

		localStorage.setItem(STORAGE_KEY, JSON.stringify({
			videoID,
			offset}));

		console.info("[Twitch VOD Chat Offset] saved offset", offset,
			"for videoID:", videoID);
	}

	function initializeOffsetForVideo(videoID) {
		if (!videoID || activeVideoID === videoID) {
			return;
		}

		activeVideoID = videoID;
		const saved = readSavedOffset();

		if (saved?.videoID === videoID) {
			chatOffsetSeconds = saved.offset;
		} else {
			chatOffsetSeconds = 0;
		}

		console.info("[Twitch VOD Chat Offset] initialized",
			"videoID:", videoID,
			"offset:", chatOffsetSeconds);
	}

	function isLikelyTwitchGqlUrl(input) {
		const url = typeof input === "string"
			? input
			: input instanceof Request
				? input.url
				: "";

		return url.includes("gql.twitch.tv/gql") || url.endsWith("/gql");
	}

	function getRequestBodyText(input, init) {
		return typeof init?.body === "string"
			? init.body
			: null;
	}

	function patchRequestBody(bodyText) {
		const parsed = JSON.parse(bodyText);
		const ops = Array.isArray(parsed) ? parsed : [parsed];
		let changed = false;

		for (const op of ops) {
			if (!op || op.operationName !== OPERATION_NAME || !op?.variables?.videoID) {
				continue;
			}

			initializeOffsetForVideo(String(op.variables.videoID));

			if (chatOffsetSeconds === 0 || !op?.variables || typeof op.variables.contentOffsetSeconds !== "number") {
				continue;
			}

			const original = op.variables.contentOffsetSeconds;
			const adjusted = Math.max(0, original - chatOffsetSeconds);

			op.variables.contentOffsetSeconds = adjusted;
			changed = true;

			console.debug("[Twitch VOD Chat Offset] request",
				"videoID:", op.variables.videoID,
				"original:", original,
				"adjusted:", adjusted,
				"offset:", chatOffsetSeconds);
		}

		if (!changed) {
			return null;
		}

		return JSON.stringify(Array.isArray(parsed)
			? ops
			: ops[0]);
	}

	function patchVideoCommentsResponseJson(data) {
		if (chatOffsetSeconds === 0) {
			return false;
		}

		const ops = Array.isArray(data)
			? data
			: [data];

		let changed = false;
		let patchedCount = 0;

		for (const op of ops) {
			const operationName = op?.extensions?.operationName ?? op?.operationName;

			if (operationName !== OPERATION_NAME) {
				continue;
			}

			const edges = op?.data?.video?.comments?.edges;

			if (!Array.isArray(edges)) {
				continue;
			}

			for (const edge of edges) {
				const node = edge?.node;

				if (node && typeof node.contentOffsetSeconds === "number") {
					const original = node.contentOffsetSeconds;
					const adjusted = Math.max(0, original + chatOffsetSeconds);
					node.contentOffsetSeconds = adjusted;
					changed = true;
					patchedCount += 1;
				}
			}
		}

		if (changed) {
			console.debug("[Twitch VOD Chat Offset] response patched messages:", patchedCount,
				"offset:", chatOffsetSeconds);
		}

		return changed;
	}

	async function patchResponse(response) {
		const contentType = response.headers.get("content-type") || "";

		if (!contentType.includes("application/json")) {
			return response;
		}

		let data;

		try {
			data = await response.clone().json();
		} catch {
			return response;
		}

		const changed = patchVideoCommentsResponseJson(data);

		if (!changed) {
			return response;
		}

		const headers = new Headers(response.headers);
		headers.delete("content-length");

		return new Response(JSON.stringify(data), {
			status: response.status,
			statusText: response.statusText,
			headers
		});
	}

	window.fetch = async function twitchVodChatOffsetFetch(input, init) {
		try {
			if (!isLikelyTwitchGqlUrl(input)) {
				return originalFetch.apply(this, arguments);
			}

			const bodyText = getRequestBodyText(input, init);

			if (typeof bodyText !== "string" ||
				!bodyText.includes(OPERATION_NAME)) {
				return originalFetch.apply(this, arguments);
			}

			const patchedBody = patchRequestBody(bodyText);
			let response;

			if (patchedBody) {
				const patchedInit = { ...init, body: patchedBody };
				response = await originalFetch.call(this, input, patchedInit);
			} else {
				response = await originalFetch.apply(this, arguments);
			}

			return await patchResponse(response);
		} catch (err) {
			console.warn("[Twitch VOD Chat Offset] patch failed:", err);
			return originalFetch.apply(this, arguments);
		}
	};

	window.twitchVodChatOffset = {
		set(offset) {
			const parsed = Number(offset);

			if (!Number.isFinite(parsed)) {
				console.warn(`[Twitch VOD Chat Offset] invalid offset: ${offset}`);
				return;
			}

			if (!activeVideoID) {
				console.warn("[Twitch VOD Chat Offset] no active videoID yet; wait for VOD chat to load, then try again");
				return;
			}

			saveOffsetForVideo(activeVideoID, parsed);
			console.info("[Twitch VOD Chat Offset] saved offset. Reload page to apply from first chat request:",
				{
					videoID: activeVideoID,
					offset: parsed
				});

			location.reload();
		}
	};

	console.info(`[Twitch VOD Chat Offset] loaded; offset defaults to ${chatOffsetSeconds}`);
})();
