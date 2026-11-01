// ==UserScript==
// @name			Twitch: FFZ Transparent Fullscreen Chat
// @description		Frankerfacez FS Chat addon: fixes transparency and hides chat's scrollbar until hovered
// @version			1.2.1
// @namespace		Mugnum.Scripts.Twitch.FfzTransparentFullscreenChat
// @author			Mugnum
// @license			MIT License
// @icon			https://www.google.com/s2/favicons?sz=64&domain=twitch.tv
// @downloadURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/twitch-ffz-transparent-fschat.user.js
// @updateURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/twitch-ffz-transparent-fschat.user.js
// @match			https://www.twitch.tv/*
// @grant			none
// @run-at			document-end
// ==/UserScript==

(() => {
	"use strict";

	const STYLE_ID = "tm-ffz-transparent-fschat";
	const BACKGROUND_COLOR = "rgba(0, 0, 0, 0.80)";

	if (document.getElementById(STYLE_ID)) {
		return;
	}

	const style = document.createElement("style");
	style.id = STYLE_ID;
	style.textContent = `
		/* Clear the backing layers so only one surface adds opacity. */
		html body .ffz--fschat > .channel-root__right-column,
		html body .ffz--fschat > .channel-root__right-column > div {
			background-color: transparent !important;
		}

		html body .ffz--fschat .video-chat {
			background-color: ${BACKGROUND_COLOR} !important;
		}

		/* Hide FFZ's overlay border without changing its dimensions. */
		html body .ffz--fschat.ffz--fschat > .channel-root__right-column > div {
			border-color: transparent !important;
		}

		/* Hide native scrollbars without changing the chat's available width. */
		html body .ffz--fschat:not(:hover),
		html body .ffz--fschat:not(:hover) * {
			scrollbar-color: transparent transparent !important;
		}
	`;

	document.head.appendChild(style);
})();
