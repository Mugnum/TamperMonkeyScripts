// ==UserScript==
// @name         Vods: User Highlighter
// @namespace    Mugnum.Scripts.Vods
// @version      1.1.0
// @description  Highlight specific users in chat (moon2.tv + chatreplay.stream)
// @match        *://moon2.tv/youtube/*
// @match        *://chatreplay.stream/chat/*
// @grant        none
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
            return document.querySelector(".css-1welr70");
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
            return container.querySelectorAll(".css-8atqhb");
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
            const el = messageEl.querySelector(".css-1avb5m9 span");
            return el?.textContent.trim() || null;
        }
        if (IS_CHATREPLAY) {
            const el = messageEl.querySelector("a.username .message-author") ||
                messageEl.querySelector(".username .message-author") ||
                messageEl.querySelector(".message-author");

            return el?.textContent.trim() || null;
        }

        return null;
    }

    function getHighlightStyle() {
        if (IS_MOON2) {
            return {
                backgroundColor: "#3838385c",
                paddingTop: "0px",
                paddingBottom: "2px",
                marginTop: "2px",
                marginBottom: "1px"
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
            return el.classList.contains("css-8atqhb");
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

        return el.closest(".css-8atqhb, .message-layout");
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

        getMessageElements(container).forEach(highlightMessage);
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
