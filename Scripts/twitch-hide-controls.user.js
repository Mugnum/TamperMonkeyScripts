// ==UserScript==
// @name			Twitch: Hide Controls on Hotkey
// @description		Hides player controls on "H" shortcut
// @version			1.1.0
// @namespace		Mugnum.Scripts.Twitch.ToggleControls
// @author			Mugnum
// @license			MIT License
// @icon			https://www.google.com/s2/favicons?sz=64&domain=twitch.tv
// @downloadURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/twitch-hide-controls.user.js
// @updateURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/twitch-hide-controls.user.js
// @match			https://www.twitch.tv/*
// @grant			none
// ==/UserScript==

(function () {
	"use strict";

	let _isHidden = false;
	const HIDE_SHORTCUT = "h";
	const STYLE_ID = "tm-hide-twitch-controls";
	const css = `
		[data-a-target="player-controls"],
		.player-controls,
		.top-bar,
		.player-overlay-background,
		[data-a-target="player-overlay-click-handler"],
		#channel-player-disclosures {
			opacity: 0 !important;
			visibility: hidden !important;
			pointer-events: none !important;
		}
    `;

	function isEditable(el) {
		if (!(el instanceof HTMLElement)) {
			return false;
		}

		return (el.isContentEditable ||
			el.closest('[contenteditable="true"]') ||
			el.tagName === "INPUT" ||
			el.tagName === "TEXTAREA" ||
			el.closest("input, textarea"));
	}

	function enableHide() {
		if (document.getElementById(STYLE_ID)) {
			return;
		}

		const style = document.createElement("style");
		style.id = STYLE_ID;
		style.textContent = css;
		document.head.appendChild(style);
		document.body.classList.add("hide-cursor");
	}

	function disableHide() {
		const style = document.getElementById(STYLE_ID);

		if (style) {
			style.remove();
		}

		document.body.classList.remove("hide-cursor");
	}

	window.addEventListener("keydown", (e) => {
		if (!e ||
			e.key.toLowerCase() !== HIDE_SHORTCUT ||
			e.ctrlKey ||
			e.altKey ||
			e.metaKey ||
			isEditable(e.target)) {
			return;
		}

		_isHidden = !_isHidden;

		if (_isHidden) {
			enableHide();
		} else {
			disableHide();
		}

		e.preventDefault();
		e.stopImmediatePropagation();
	}, true);
})();
