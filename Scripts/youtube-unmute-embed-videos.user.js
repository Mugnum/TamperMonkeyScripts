// ==UserScript==
// @name			YouTube: Unmute Embedded Videos
// @description		Automatically unmutes embedded YouTube videos on page load
// @version			1.2.0
// @namespace		Mugnum.Scripts.YouTube.UnmuteEmbedVideos
// @author			Mugnum
// @license			MIT License
// @icon			https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @downloadURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/youtube-unmute-embed-videos.user.js
// @updateURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/youtube-unmute-embed-videos.user.js
// @match			https://www.youtube.com/embed/*
// @match			https://www.youtube-nocookie.com/embed/*
// @run-at			document-start
// @grant			none
// ==/UserScript==

(function () {
	"use strict";

	const RETRY_INTERVAL_MS = 500;
	const MAX_RETRIES = 20;

	function unmute() {
		const player = document.querySelector(".html5-video-player");
		const video = document.querySelector("video");
		player?.unMute?.();

		if (video) {
			video.muted = false;
			video.defaultMuted = false;
		}

		return Boolean(player || video);
	}

	function unmuteWhenReady() {
		let attempts = 0;

		const timer = setInterval(() => {
			const foundPlayer = unmute();
			attempts++;

			if (foundPlayer || attempts >= MAX_RETRIES) {
				clearInterval(timer);
			}
		}, RETRY_INTERVAL_MS);
	}

	function installInteractionFallback() {
		const retryAfterInteraction = () => {
			unmute();
			setTimeout(unmute, 100);
		};

		for (const eventName of ["pointerdown", "keydown", "touchstart"]) {
			document.addEventListener(eventName, retryAfterInteraction, {
				capture: true,
				passive: true
			});
		}
	}

	unmuteWhenReady();
	installInteractionFallback();
})();
