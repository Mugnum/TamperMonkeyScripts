// ==UserScript==
// @name			ChatGPT: Remove Black Background
// @description		Replace ChatGPT pure black OLED background with a softer dark background
// @version			1.3.0
// @namespace		Mugnum.Scripts.ChatGpt.Styling
// @author			Mugnum
// @license			MIT License
// @match			https://chatgpt.com/*
// @icon			https://www.google.com/s2/favicons?sz=64&domain=chatgpt.com
// @downloadURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/chatgpt-remove-black-background.user.js
// @updateURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/chatgpt-remove-black-background.user.js
// @run-at			document-start
// @grant			GM_addStyle
// ==/UserScript==

(() => {
	GM_addStyle(`
		html.dark {
			--main-surface-primary: #272727 !important;
			--main-surface-secondary: #272727 !important;
		}

		body,main,[class*="bg-token-main-surface-primary"] {
			background-color: #272727 !important;
		}

		.bg-token-sidebar-surface-primary {
			background-color: #202020;
		}

		.bg-\\(--sidebar-surface-primary\\) {
			background-color: #202020;
		}

		html.dark, html.dark :not(:where(.light,.light *)) {
			--main-surface-primary: #272727ed;
		}

		.bg-token-bg-elevated-secondary {
			background-color: #202020;
		}
	`);
})();
