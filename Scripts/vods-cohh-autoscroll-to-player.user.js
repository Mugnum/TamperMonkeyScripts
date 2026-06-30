// ==UserScript==
// @name			Cohh vods: Auto Scroll to Player
// @description		Scrolls video player to bottom of screen
// @version			1.1.0
// @namespace		Mugnum.Scripts.Vods.CohhScroll
// @author			Mugnum
// @license			MIT License
// @icon			https://www.google.com/s2/favicons?sz=64&domain=cohhilition.com
// @downloadURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/vods-cohh-autoscroll-to-player.user.js
// @updateURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/vods-cohh-autoscroll-to-player.user.js
// @match			https://vodchat.cohhilition.com/video/*
// @grant			GM_registerMenuCommand
// ==/UserScript==

(function () {
    "use strict";

    /**
     * Scrolls screen, so that bottom of screen aligns with bottom of player.
     * @returns {Boolean} Scrolling success indicator.
     */
    function scrollToPlayer() {
        const paddingInPx = 10;
        const cohhPlayerSelector = "body#video div.row div#player_holder iframe#player";
        const player = document.querySelector(cohhPlayerSelector);

        if (!player) {
            return false;
        }

        const rect = player.getBoundingClientRect();
        const absoluteBottom = window.scrollY + rect.bottom;
        const targetScroll = absoluteBottom - window.innerHeight + paddingInPx;

        window.scrollTo({
            top: targetScroll,
            behavior: "auto"
        });

        return true;
    }

    /**
     * Registers mutation observer until scrollToPlayer succeeds.
     */
    function registerObserver() {
        const observer = new MutationObserver(() => {
            if (scrollToPlayer()) {
                observer.disconnect();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    /**
     * Applies custom styles to page.
     * Makes video appear more fullscreen.
     */
    function applyStyles() {
        const body = document.querySelector("body#video");

        if (body) {
            body.style.maxWidth = "2000px";
        }
    }

    /**
     * Registers scrolling on switching video.
     */
    function registerScrollOnVideoSwitch() {
        document.getElementById("other_videos").addEventListener("click", scrollToPlayer);
    }

    /**
     * Initializes script on page load.
     */
    function init() {
        GM_registerMenuCommand("Scroll to player", scrollToPlayer);
        applyStyles();
        registerScrollOnVideoSwitch();

        if (!scrollToPlayer()) {
            registerObserver();
        }
    }

    init();
})();
