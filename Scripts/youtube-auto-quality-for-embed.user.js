// ==UserScript==
// @name         YouTube: Set high quality for embed
// @description  Makes youtube embedded videos at higher resolution
// @namespace    Mugnum.Scripts.YouTube.AutoQualityForEmbed
// @version      1.0.0
// @match        https://www.youtube.com/embed/*
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
    "use strict";

    function setQuality() {
        const ytPlayer = document.querySelector('.html5-video-player');

        if (!ytPlayer) {
            return;
        }

        if (ytPlayer.setPlaybackQualityRange) {
            ytPlayer.setPlaybackQualityRange('hd1440');
            ytPlayer.setPlaybackQuality('hd1440');
        }
    }

    function init() {
        GM_registerMenuCommand("Set video quality", setQuality);
        setTimeout(setQuality, 2000);
    }

    init();
})();
