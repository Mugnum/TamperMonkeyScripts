// ==UserScript==
// @name         YouTube: Disable Ctrl+Arrow Chapter Jump
// @description  Removes shortcuts for jumping to next chapter on YouTube
// @match        https://www.youtube.com/*
// @namespace    Mugnum.Scripts.YouTube.RemoveChapterShortcuts
// @version      1.0.0
// @grant        none
// @run-at       document-start
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
