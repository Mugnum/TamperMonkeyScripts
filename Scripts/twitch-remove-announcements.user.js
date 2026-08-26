// ==UserScript==
// @name			Twitch: Remove Upsell Announcements
// @description		Removes announcements from footer of Twitch page.
// @version			1.1.0
// @namespace		Mugnum.Scripts.Twitch.RemoveAnnouncements
// @author			Mugnum
// @license			MIT License
// @icon			https://www.google.com/s2/favicons?sz=64&domain=twitch.tv
// @downloadURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/twitch-remove-announcements.user.js
// @updateURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/twitch-remove-announcements.user.js
// @match			https://www.twitch.tv/*
// @match			https://m.twitch.tv/*
// @run-at			document-start
// @grant			none
// ==/UserScript==

(() => {
	"use strict";

	const STOP_WATCHING_TIMEOUT_SEC = 15_000;
	const FOOTER_SELECTOR = "#twilight-sticky-footer-root";

	function removeStickyFooter() {
		document.querySelector(FOOTER_SELECTOR)?.remove();
	}

	removeStickyFooter();
	const observer = new MutationObserver(() => {
		removeStickyFooter();
	});

	observer.observe(document.documentElement, {
		childList: true,
		subtree: true
	});

	setTimeout(() => observer.disconnect(), STOP_WATCHING_TIMEOUT_SEC);
})();
