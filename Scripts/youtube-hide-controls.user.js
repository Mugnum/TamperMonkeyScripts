// ==UserScript==
// @name			YouTube: Hide Controls on Hotkey
// @description		Hides player controls on "H" shortcut
// @version			1.5.3
// @namespace		Mugnum.Scripts.YouTube.TogglePlayerUI
// @author			Mugnum
// @license			MIT License
// @icon			https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @downloadURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/youtube-hide-controls.user.js
// @updateURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/youtube-hide-controls.user.js
// @match			https://www.youtube.com/*
// @grant			none
// @run-at			document-start
// ==/UserScript==

(function () {
	"use strict";

	const KEYBOARD_SHORTCUT = "KeyH";
	const HIDDEN_CLASS = "tm-player-ui-hidden";
	const style = document.createElement("style");
	style.textContent = `
		.html5-video-player.${HIDDEN_CLASS} .ytp-chrome-top,
		.html5-video-player.${HIDDEN_CLASS} .ytp-gradient-top,
		.html5-video-player.${HIDDEN_CLASS} .ytp-chrome-bottom,
		.html5-video-player.${HIDDEN_CLASS} .ytp-gradient-bottom,
		.html5-video-player.${HIDDEN_CLASS} .ytp-overlays-container,
		.html5-video-player.${HIDDEN_CLASS} .ytp-tooltip,
		.html5-video-player.${HIDDEN_CLASS} .ytp-speedmaster-overlay,
		.html5-video-player.${HIDDEN_CLASS} .ytp-bezel,
		.html5-video-player.${HIDDEN_CLASS} .ytp-pause-overlay,
        .html5-video-player.${HIDDEN_CLASS} .ytp-fullscreen-grid-buttons-container,
		.html5-video-player.${HIDDEN_CLASS} .ytp-touch-response {
			display: none !important;
			visibility: hidden !important;
			opacity: 0 !important;
			pointer-events: none !important;
			animation: none !important;
			transition: none !important;
		}
	`;

	document.documentElement.appendChild(style);

	function isEditable(element) {
		return element instanceof Element &&
			Boolean(element.closest('input, textarea, select, [contenteditable], [role="textbox"]'));
	}

	function togglePlayerUI() {
		const player = document.querySelector('.html5-video-player');

		if (player) {
			player.classList.toggle(HIDDEN_CLASS);
		}
	}

	window.addEventListener("keydown",
		event => {
			if (event.code !== KEYBOARD_SHORTCUT ||
				event.repeat ||
				event.ctrlKey ||
				event.altKey ||
				event.metaKey ||
				event.shiftKey ||
				isEditable(event.target)) {
				return;
			}

			event.preventDefault();
			event.stopImmediatePropagation();
			togglePlayerUI();
		}, true);
})();
