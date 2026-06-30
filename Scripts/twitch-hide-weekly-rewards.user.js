// ==UserScript==
// @name			Twitch: Hide Weekly Rewards Popup
// @description		Removes the "You made Weekly Rewards progress!" message
// @version			1.0.0
// @namespace		Mugnum.Scripts.Twitch.HideWeeklyRewards
// @author			Mugnum
// @license			MIT License
// @icon			https://www.google.com/s2/favicons?sz=64&domain=twitch.tv
// @downloadURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/twitch-hide-weekly-rewards.user.js
// @updateURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/twitch-hide-weekly-rewards.user.js
// @match			https://www.twitch.tv/*
// @run-at			document-start
// @grant			none
// ==/UserScript==

(() => {
	'use strict';

	// Only supports English localization.
	const MESSAGE = 'You made Weekly Rewards progress!';

	function removeWeeklyRewardsPopups(root = document) {
		const messages = root.querySelectorAll?.('.tw-snackbar-message') ?? [];

		for (const message of messages) {
			if (message.textContent.trim() !== MESSAGE) {
				continue;
			}

			const popup = message.closest('.snackbar-item__container');

			if (popup) {
				popup.remove();
			}
		}
	}

	function observe() {
		removeWeeklyRewardsPopups();
		const observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				for (const node of mutation.addedNodes) {
					if (node.nodeType !== Node.ELEMENT_NODE) {
						continue;
					}
					if (node.matches?.('.tw-snackbar-message, .snackbar-item__container')) {
						removeWeeklyRewardsPopups(node.parentElement || document);
						continue;
					}
					removeWeeklyRewardsPopups(node);
				}
			}
		});

		observer.observe(document.documentElement, {
			childList: true,
			subtree: true,
		});
	}

	observe();
})();
