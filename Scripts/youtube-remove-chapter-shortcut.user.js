// ==UserScript==
// @name			YouTube: Disable Ctrl+Arrow Chapter Jump
// @description		Removes shortcuts for jumping to next chapter on YouTube
// @version			1.1.0
// @namespace		Mugnum.Scripts.YouTube.RemoveChapterShortcuts
// @author			Mugnum
// @license			MIT License
// @icon			https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @downloadURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/youtube-remove-chapter-shortcut.user.js
// @updateURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/youtube-remove-chapter-shortcut.user.js
// @match			https://www.youtube.com/*
// @grant			none
// @run-at			document-start
// ==/UserScript==

(function () {
	"use strict";

	function isEditable(el) {
		return el instanceof HTMLElement &&
			(el.isContentEditable ||
				el.tagName === "INPUT" ||
				el.tagName === "TEXTAREA");
	}

	function handler(e) {
		if (!e.ctrlKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) {
			return;
		}

		// Allow normal text editing navigation.
		if (isEditable(e.target)) {
			return;
		}

		e.stopImmediatePropagation();
	}

	window.addEventListener("keydown", handler, true);
	window.addEventListener("keyup", handler, true);
})();
