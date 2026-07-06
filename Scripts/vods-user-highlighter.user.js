// ==UserScript==
// @name			Vods: User Highlighter
// @namespace		Mugnum.Scripts.Vods
// @version			2.4.0
// @description		Highlight specific users in chat (moon2.tv + chatreplay.stream)
// @author			Mugnum
// @license			MIT License
// @icon			https://www.google.com/s2/favicons?sz=64&domain=chatreplay.stream
// @downloadURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/vods-user-highlighter.user.js
// @match			*://moon2.tv/youtube/*
// @match			*://chatreplay.stream/chat/*
// @grant			none
// ==/UserScript==

(function () {
	"use strict";

	// Set users here.
	const HIGHLIGHT_USERS = [
		"Username1"
		,"Username2"
	];

	const IS_MOON2 = location.hostname.includes("moon2.tv");
	const IS_CHATREPLAY = location.hostname.includes("chatreplay.stream");
	const USER_SET = new Set(
		HIGHLIGHT_USERS.map(u => u.toLowerCase())
	);

	function getMessageContainer() {
		if (IS_MOON2) {
			return document.body;
		}
		if (IS_CHATREPLAY) {
			return document.querySelector("#messages");
		}

		return null;
	}

	function getMessageElements(container) {
		if (!container) {
			return [];
		}
		if (IS_MOON2) {
			return container.querySelectorAll(".chat-message-optimize");
		}
		if (IS_CHATREPLAY) {
			return container.querySelectorAll(".message-layout");
		}

		return [];
	}

	function getUsername(messageEl) {
		if (!messageEl) {
			return null;
		}
		if (IS_MOON2) {
			const el = messageEl.querySelector(":scope .font-bold");
			return el?.textContent.trim() || null;
		}
		if (IS_CHATREPLAY) {
			const el = messageEl.querySelector(".message-author");
			return el?.textContent.trim() || null;
		}

		return null;
	}

	function getHighlightStyle() {
		if (IS_MOON2) {
			return {
				backgroundColor: "#62626247"
			};
		}
		if (IS_CHATREPLAY) {
			return {
				backgroundColor: "#4f4d4d73",
				paddingTop: "4px",
				paddingBottom: "4px",
				marginTop: "2px",
				marginBottom: "1px"
			};
		}

		return {};
	}

	function resetHighlightStyle(targetEl) {
		if (!targetEl?.style) {
			return;
		}

		targetEl.style.backgroundColor = "";
		targetEl.style.paddingTop = "";
		targetEl.style.paddingBottom = "";
		targetEl.style.marginTop = "";
		targetEl.style.marginBottom = "";
	}

	function highlightMessage(messageEl) {
		const usernameRaw = getUsername(messageEl);

		if (!usernameRaw) {
			return;
		}

		const username = usernameRaw.trim().toLowerCase();
		let targetEl = messageEl;

		if (USER_SET.has(username)) {
			Object.assign(targetEl.style, getHighlightStyle());
			return;
		}

		resetHighlightStyle(targetEl);
	}

	function isMessageElement(el) {
		if (!(el instanceof HTMLElement)) {
			return false;
		}
		if (IS_MOON2) {
			return el.classList.contains("chat-message-optimize");
		}
		if (IS_CHATREPLAY) {
			return el.classList.contains("message-layout");
		}

		return false;
	}

	function findMessageElement(el) {
		if (!(el instanceof HTMLElement)) {
			return null;
		}
		if (IS_MOON2) {
			return el.closest(".chat-message-optimize");
		}
		if (IS_CHATREPLAY) {
			return el.closest(".message-layout");
		}

		return null;
	}

	function startObserver() {
		const container = getMessageContainer();

		if (!container) {
			return false;
		}

		function processNode(node) {
			if (!(node instanceof HTMLElement)) {
				return;
			}
			if (isMessageElement(node)) {
				highlightMessage(node);
			}

			getMessageElements(node).forEach(highlightMessage);
		}

		const observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				mutation.addedNodes.forEach(processNode);

				if (mutation.target instanceof Node) {
					const parent = mutation.target.nodeType === 3
						? mutation.target.parentElement
						: mutation.target;

					const el = findMessageElement(parent);

					if (el) {
						highlightMessage(el);
					}
				}
			}
		});

		observer.observe(container, {
			childList: true,
			subtree: true,
			characterData: true
		});

		getMessageElements(container)?.forEach(highlightMessage);
		return true;
	}

	function init() {
		const interval = setInterval(() => {
			if (startObserver()) {
				clearInterval(interval);
			}
		}, 500);
	}

	init();
})();
