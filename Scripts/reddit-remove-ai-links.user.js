// ==UserScript==
// @name			Reddit: Remove AI links
// @description		Removes bullshit AI links from comments and reverts them to plain text
// @version			1.1.0
// @namespace		Mugnum.Scripts.Reddit
// @author			Mugnum
// @license			MIT License
// @icon			https://www.google.com/s2/favicons?sz=64&domain=reddit.com
// @downloadURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/reddit-remove-ai-links.user.js
// @updateURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/reddit-remove-ai-links.user.js
// @match			https://www.reddit.com/*
// @match			https://new.reddit.com/*
// @match			https://sh.reddit.com/*
// @run-at			document-idle
// @grant			none
// ==/UserScript==

(() => {
	'use strict';
	const INCLUDE_POST_BODIES = false;

	function isGeneratedRedditAnswerLink(a) {
		if (!(a instanceof HTMLAnchorElement)) {
			return false;
		}

		const href = a.getAttribute("href") || "";
		const looksLikeAnswerLink = href.includes("/answers/") &&
			(
				href.includes("source=PDP_HIGHLIGHT") ||
				href.includes("source%3DPDP_HIGHLIGHT")
			);

		if (!looksLikeAnswerLink) {
			return false;
		}

		const hasSearchSparkleIcon = Boolean(a.querySelector(
			'svg[icon-name="search-sparkle"], svg[icon-name="search"]'
		));

		return hasSearchSparkleIcon;
	}

	function getAnchorTextWithoutIcon(a) {
		const clone = a.cloneNode(true);
		clone.querySelectorAll("svg").forEach(svg => {
			const wrapper = svg.closest("span");

			if (wrapper && wrapper.textContent?.trim() === "") {
				wrapper.remove();
				return;
			}

			svg.remove();
		});

		clone.querySelectorAll("span").forEach(span => {
			if (span.textContent?.trim() === "" && span.children.length === 0) {
				span.remove();
			}
		});

		return clone.textContent;
	}

	function unwrapGeneratedLink(a) {
		const text = getAnchorTextWithoutIcon(a);

		if (!text || !text.trim()) {
			return;
		}

		a.replaceWith(document.createTextNode(text));
	}

	function getSearchRoot(root) {
		if ((root instanceof Document) ||
			(root instanceof DocumentFragment) ||
			(root instanceof Element)) {
			return root;
		}

		return null;
	}

	function cleanRoot(root) {
		const searchRoot = getSearchRoot(root);

		if (!searchRoot) {
			return;
		}

		const commentSelectors = [
			'[slot="comment"]',
			'[id$="-comment-rtjson-content"]',
			'shreddit-comment'
		];

		const bodySelectors = INCLUDE_POST_BODIES
			? ['[slot="text-body"]', '[id$="-post-rtjson-content"]']
			: [];

		const scopeSelector = [...commentSelectors, ...bodySelectors].join(',');
		const scopes = [];

		if (searchRoot instanceof Element && searchRoot.matches(scopeSelector)) {
			scopes.push(searchRoot);
		}

		scopes.push(...searchRoot.querySelectorAll(scopeSelector));

		for (const scope of scopes) {
			const links = scope.querySelectorAll('a[href*="/answers/"]');
			for (const a of links) {
				if (isGeneratedRedditAnswerLink(a)) {
					unwrapGeneratedLink(a);
				}
			}
		}
	}

	let queued = false;

	function queueClean() {
		if (queued) {
			return;
		}

		queued = true;
		requestAnimationFrame(() => {
			queued = false;
			cleanRoot(document);
		});
	}

	cleanRoot(document);

	const observer = new MutationObserver(mutations => {
		for (const mutation of mutations) {
			for (const node of mutation.addedNodes) {
				if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
					cleanRoot(node);
				}
			}
		}

		queueClean();
	});

	observer.observe(document.documentElement, {
		childList: true,
		subtree: true
	});
})();
