// ==UserScript==
// @name			YouTube Studio: Auto Show More
// @description		Automatically expands advanced settings when opening a video's edit page in YouTube Studio
// @version			1.3.0
// @namespace		Mugnum.Scripts.YouTube.Studio.AutoShowMore
// @author			Mugnum
// @license			MIT License
// @icon			https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @downloadURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/youtube-studio-auto-show-more.user.js
// @updateURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/youtube-studio-auto-show-more.user.js
// @match			https://studio.youtube.com/*
// @grant			none
// @run-at			document-start
// ==/UserScript==

(function () {
	"use strict";

	const RETRY_INTERVAL = 500;
	const CLICK_COOLDOWN = 1500;
	const BUTTON_SELECTOR = 'button[aria-label="Show advanced settings"]:not([aria-disabled="true"])';
	let lastClickedButton = null;
	let lastClickTime = 0;

	function findInOpenShadowRoots(selector, root = document) {
		const directMatch = root.querySelector(selector);

		if (directMatch) {
			return directMatch;
		}

		const elements = root.querySelectorAll('*');

		for (const element of elements) {
			if (!element.shadowRoot) {
				continue;
			}

			const shadowMatch = findInOpenShadowRoots(selector, element.shadowRoot);

			if (shadowMatch) {
				return shadowMatch;
			}
		}

		return null;
	}

	function isVisible(element) {
		if (!(element instanceof HTMLElement)) {
			return false;
		}

		const style = getComputedStyle(element);
		const rect = element.getBoundingClientRect();

		return (style.display !== "none" &&
			style.visibility !== "hidden" &&
			rect.width > 0 &&
			rect.height > 0);
	}

	function expandAdvancedSettings() {
		const button = findInOpenShadowRoots(BUTTON_SELECTOR);

		if (!button || !isVisible(button)) {
			return;
		}

		const now = Date.now();

		if (button === lastClickedButton &&
				now - lastClickTime < CLICK_COOLDOWN) {
			return;
		}

		lastClickedButton = button;
		lastClickTime = now;
		button.click();
	}

	const observer = new MutationObserver(() => {
		expandAdvancedSettings();
	});

	observer.observe(document.documentElement, {
		childList: true,
		subtree: true
	});

	window.addEventListener("yt-navigate-finish", expandAdvancedSettings);
	window.addEventListener("popstate", expandAdvancedSettings);
	window.setInterval(expandAdvancedSettings, RETRY_INTERVAL);
	expandAdvancedSettings();
})();
