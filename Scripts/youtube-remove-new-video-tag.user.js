// ==UserScript==
// @name			YouTube: Remove "New" Video Tag
// @description		Removes the "New" badge from recommended video thumbnails
// @version			1.0.0
// @namespace		Mugnum.Scripts.YouTube.RemoveNewVideoTag
// @author			Mugnum
// @license			MIT License
// @icon			https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @downloadURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/youtube-remove-new-video-tag.user.js
// @updateURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/youtube-remove-new-video-tag.user.js
// @match			https://www.youtube.com/*
// @grant			GM_addStyle
// @run-at			document-start
// ==/UserScript==

(() => {
	"use strict";

	GM_addStyle(`
		.ytThumbnailOverlayBadgeViewModelHost.ytThumbnailOverlayBadgeViewModelTopStart.ytThumbnailOverlayBadgeViewModelMedium:has(badge-shape[aria-label="New"]) {
			display: none !important;
		}
	`);
})();
