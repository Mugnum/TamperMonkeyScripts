// ==UserScript==
// @name			YouTube: Save Screenshot on Hotkey
// @description		Press Ctrl+Shift+S to save screenshot of current video frame
// @version			1.1.0
// @namespace		Mugnum.Scripts.YouTube.SaveFrameScreenshot
// @author			Mugnum
// @license			MIT License
// @icon			https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @downloadURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/youtube-save-screenshot.user.js
// @updateURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/youtube-save-screenshot.user.js
// @match			https://www.youtube.com/*
// @grant			none
// @run-at			document-idle
// ==/UserScript==

(function () {
	"use strict";

	function createFilename() {
		const title = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim() ||
			document.querySelector('meta[name="title"]')?.content?.trim() ||
			document.title.replace(/\s*-\s*YouTube\s*$/, "").trim() ||
			"YouTube video";

		const now = new Date();
		const timestamp = [
			now.getFullYear(),
			String(now.getMonth() + 1).padStart(2, "0"),
			String(now.getDate()).padStart(2, "0")
		].join("-") + " " + [
			String(now.getHours()).padStart(2, "0"),
			String(now.getMinutes()).padStart(2, "0"),
			String(now.getSeconds()).padStart(2, "0")
		].join("-");

		const safeTitle = title
			.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
			.replace(/[.\s]+$/g, "")
			.trim()
			.slice(0, 180);

		return `${safeTitle || 'YouTube video'} - ${timestamp}.png`;
	}

	function downloadBlob(blob, filename) {
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");

		link.href = url;
		link.download = filename;
		link.style.display = "none";

		document.body.appendChild(link);
		link.click();
		link.remove();

		setTimeout(() => {
			URL.revokeObjectURL(url);
		}, 10_000);
	}

	function saveCurrentFrame() {
		const video = document.querySelector(".html5-video-player video.video-stream");

		if (!video) {
			console.warn("[YouTube Frame Capture] No video element found.");
			return;
		}

		if (!video.videoWidth || !video.videoHeight) {
			console.warn("[YouTube Frame Capture] The video frame is not ready.");
			return;
		}

		const canvas = document.createElement('canvas');
		const context = canvas.getContext('2d', {
			alpha: false
		});

		if (!context) {
			console.error("[YouTube Frame Capture] Could not create a canvas context.");
			return;
		}

		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;

		try {
			context.drawImage(video, 0, 0, canvas.width, canvas.height);
		} catch (error) {
			console.error("[YouTube Frame Capture] Could not copy the video frame.", error);
			return;
		}

		canvas.toBlob(
			blob => {
				if (!blob) {
					console.error("[YouTube Frame Capture] PNG creation failed.");
					return;
				}

				const filename = createFilename(video);
				downloadBlob(blob, filename);
				console.info(`[YouTube Frame Capture] Saved ${filename} at ${canvas.width}×${canvas.height}.`);
			},
			"image/png");
	}

	window.addEventListener("keydown",
		event => {
			if (event.code !== "KeyS" ||
					!event.shiftKey ||
					!event.ctrlKey ||
					event.repeat ||
					event.altKey ||
					event.metaKey) {
				return;
			}

			event.preventDefault();
			event.stopImmediatePropagation();
			saveCurrentFrame();
		},
		true);
})();
