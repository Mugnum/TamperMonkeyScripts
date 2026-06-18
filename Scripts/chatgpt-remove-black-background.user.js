// ==UserScript==
// @name         ChatGPT: Remove black background
// @namespace    Mugnum.Scripts.ChatGPT
// @version      1.2.0
// @description  Replaces pure black background on OLED screens on ChatGPT
// @author       Mugnum
// @match        https://chatgpt.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=chatgpt.com
// @run-at       document-start
// @grant        GM_addStyle
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
