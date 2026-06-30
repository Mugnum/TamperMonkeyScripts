// ==UserScript==
// @name			YouTube: Set High Quality for Embed
// @description		Makes YouTube embedded videos at higher resolution
// @version			1.1.0
// @namespace		Mugnum.Scripts.YouTube.AutoQualityForEmbed
// @author			Mugnum
// @license			MIT License
// @icon			https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @downloadURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/youtube-auto-quality-for-embed.user.js
// @updateURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/youtube-auto-quality-for-embed.user.js
// @match			https://www.youtube.com/embed/*
// @grant			GM_registerMenuCommand
// ==/UserScript==

(function () {
	"use strict";

	const PREFERRED_QUALITY = "hd1440";
	const DELAY_IN_MS = 3000;

	function setQuality() {
		const ytPlayer = document.querySelector('.html5-video-player');

		if (!ytPlayer) {
			return;
		}

		if (ytPlayer.setPlaybackQualityRange) {
			ytPlayer.setPlaybackQualityRange(PREFERRED_QUALITY);
			ytPlayer.setPlaybackQuality(PREFERRED_QUALITY);
		}
	}

	function init() {
		GM_registerMenuCommand("Set video quality", setQuality);
		setTimeout(setQuality, DELAY_IN_MS);
	}

	init();
})();
