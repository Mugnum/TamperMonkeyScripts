// ==UserScript==
// @name			YouTube Studio: Restore Likes/Dislikes
// @namespace		Mugnum.Scripts.YouTube.StudioRestoreLikes
// @version			1.0.0
// @description		Restores a likes/dislikes column in YouTube Studio Content
// @match			https://studio.youtube.com/*
// @run-at			document-start
// @grant			none
// ==/UserScript==

(() => {
	'use strict';

	let renderQueued = false;
	const LIST_CREATOR_VIDEOS = '/youtubei/v1/creator/list_creator_videos';
	const GET_CREATOR_VIDEOS = '/youtubei/v1/creator/get_creator_videos';
	const REQUEST_PRIVATE_METRICS = true;
	const COLUMN_WIDTH = '164px';
	const RATING_WIDTH = '124px';
	const ratings = new Map();
	const fullNumber = new Intl.NumberFormat();
	const compactNumber = new Intl.NumberFormat(undefined, {
		notation: 'compact',
		maximumFractionDigits: 1,
	});

	function toUrl(input) {
		if (typeof input === 'string') return input;
		if (input instanceof URL) return input.href;
		if (input instanceof Request) return input.url;
		return input?.url ?? '';
	}

	function isListCreatorVideos(url) {
		return String(url).includes(LIST_CREATOR_VIDEOS);
	}

	function isVideoResponseEndpoint(url) {
		const value = String(url);

		return (
			value.includes(LIST_CREATOR_VIDEOS) ||
			value.includes(GET_CREATOR_VIDEOS)
		);
	}

	function parseCount(value) {
		const count = Number(value);
		return Number.isFinite(count) && count >= 0 ? count : null;
	}

	function patchListRequestBody(body) {
		if (!REQUEST_PRIVATE_METRICS || typeof body !== 'string') {
			return body;
		}

		let request;

		try {
			request = JSON.parse(body);
		} catch {
			return body;
		}

		if (!request?.mask || typeof request.mask !== 'object') {
			return body;
		}

		request.mask.metrics = {
			all: true,
		};

		return JSON.stringify(request);
	}

	function extractRating(video) {
		if (!video || typeof video.videoId !== 'string') {
			return null;
		}

		const privateMetrics = video.metrics;
		const privateLikes = parseCount(privateMetrics?.likeCount);
		const privateDislikes = parseCount(privateMetrics?.dislikeCount);

		if (privateLikes !== null || privateDislikes !== null) {
			return {
				videoId: video.videoId,
				likes: privateLikes,
				dislikes: privateDislikes,
				source: 'private',
			};
		}

		const publicLikes = parseCount(video.publicMetrics?.likeCount);

		if (publicLikes !== null) {
			return {
				videoId: video.videoId,
				likes: publicLikes,
				dislikes: null,
				source: 'public',
			};
		}

		return null;
	}

	function mergeRating(next) {
		const previous = ratings.get(next.videoId);

		if (previous?.source === 'private' && next.source === 'public') {
			return false;
		}

		const changed = !previous ||
			previous.likes !== next.likes ||
			previous.dislikes !== next.dislikes ||
			previous.source !== next.source;

		if (changed) {
			ratings.set(next.videoId, next);
		}

		return changed;
	}

	function ingestResponse(payload) {
		if (!payload || typeof payload !== 'object') {
			return;
		}

		let changed = false;
		const seen = new WeakSet();

		function visit(value) {
			if (!value || typeof value !== 'object' || seen.has(value)) {
				return;
			}

			seen.add(value);
			const rating = extractRating(value);

			if (rating && mergeRating(rating)) {
				changed = true;
			}

			for (const child of Object.values(value)) {
				visit(child);
			}
		}

		visit(payload);

		if (changed) {
			scheduleRender();
		}
	}

	function captureFetchResponse(response) {
		response.clone()
			.json()
			.then(ingestResponse)
			.catch(() => { });
	}

	const nativeFetch = window.fetch;

	if (typeof nativeFetch === 'function') {
		window.fetch = function patchedFetch(input, init) {
			const url = toUrl(input);
			const isListRequest = isListCreatorVideos(url);
			const isVideoRequest = isVideoResponseEndpoint(url);

			if (isListRequest && init?.body) {
				init = {
					...init,
					body: patchListRequestBody(init.body),
				};
			}

			if (isListRequest &&
				input instanceof Request &&
				!init?.body &&
				input.method !== 'GET' &&
				input.method !== 'HEAD') {
				return input
					.clone()
					.text()
					.then((body) => {
						const patchedBody = patchListRequestBody(body);

						if (patchedBody === body) {
							return nativeFetch.call(this, input, init);
						}

						const patchedRequest = new Request(input, {
							body: patchedBody,
						});

						return nativeFetch.call(this, patchedRequest, init);
					})
					.then((response) => {
						if (isVideoRequest) {
							captureFetchResponse(response);
						}

						return response;
					});
			}

			const promise = nativeFetch.call(this, input, init);

			if (isVideoRequest) {
				promise.then(
					(response) => captureFetchResponse(response),
					() => { });
			}

			return promise;
		};
	}

	const nativeXhrOpen = XMLHttpRequest.prototype.open;
	const nativeXhrSend = XMLHttpRequest.prototype.send;

	XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
		const requestUrl = String(url);
		this.__studioLikesIsListRequest = isListCreatorVideos(requestUrl);
		this.__studioLikesIsVideoRequest = isVideoResponseEndpoint(requestUrl);

		return nativeXhrOpen.apply(this, arguments);
	};

	XMLHttpRequest.prototype.send = function patchedSend(body) {
		if (this.__studioLikesIsListRequest) {
			body = patchListRequestBody(body);
		}

		if (this.__studioLikesIsVideoRequest) {
			this.addEventListener(
				'load',
				function onLoad() {
					try {
						const payload = this.responseType === 'json'
							? this.response
							: JSON.parse(this.responseText);

						ingestResponse(payload);
					} catch { }
				},
				{ once: true }
			);
		}

		return nativeXhrSend.call(this, body);
	};

	function installStyles() {
		if (document.getElementById('studio-likes-column-style')) {
			return;
		}

		const style = document.createElement('style');
		style.id = 'studio-likes-column-style';

		style.textContent = `
            .studio-likes-header,
            .studio-likes-cell {
            box-sizing: border-box;
            min-width: 164px !important;
            max-width: 164px !important;
            flex: 0 0 164px !important;
            padding-left: 12px !important;
            padding-right: 24px !important;
            }

            .studio-likes-cell {
            align-items: center;
            justify-content: flex-end;
            }

            .studio-likes-content {
            box-sizing: border-box;
            width: min(100%, 112px);
            max-width: 112px;
            margin-left: auto;
            margin-right: 12px;
            transform: translateY(-4px);
            text-align: right;
            font-variant-numeric: tabular-nums;
            }

            .studio-likes-percent {
            color: var(--ytcp-text-primary);
            font-size: 14px;
            font-weight: 400;
            line-height: 20px;
            white-space: nowrap;
            }

            .studio-likes-count {
            margin-top: 3px;
            color: var(--ytcp-text-secondary);
            font-size: 12px;
            font-weight: 400;
            line-height: 17px;
            white-space: nowrap;
            }

            .studio-likes-bar {
            width: 100%;
            height: 4px;
            margin-top: 9px;
            overflow: hidden;
            border-radius: 999px;
            background: rgba(128, 128, 128, 0.28);
            background: color-mix(
                in srgb,
                var(--ytcp-text-secondary) 28%,
                transparent);
            }

            .studio-likes-bar-positive {
            display: block;
            height: 100%;
            min-width: 2px;
            border-radius: inherit;
            opacity: 0.82;
            background: var(--ytcp-text-secondary);
            }

            .studio-likes-singleline {
            width: min(100%, 112px);
            max-width: 112px;
            margin-left: auto;
            margin-right: 12px;
            transform: translateY(-20px);
            text-align: right;
            color: var(--ytcp-text-secondary);
            font-size: 12px;
            line-height: 18px;
            white-space: nowrap;
            }
        `;

		(document.head || document.documentElement).append(style);
	}

	function findDirectChildByClass(parent, className) {
		return [...parent.children].find((element) =>
			element.classList?.contains(className)
		);
	}

	function applyColumnWidth(element) {
		element.style.minWidth = COLUMN_WIDTH;
		element.style.maxWidth = COLUMN_WIDTH;
		element.style.flex = `0 0 ${COLUMN_WIDTH}`;
		element.style.boxSizing = 'border-box';
		element.style.paddingLeft = '12px';
		element.style.paddingRight = '24px';
	}

	function ensureHeader() {
		for (const header of document.querySelectorAll('ytcp-table-header#table-header')) {
			if (header.querySelector('[data-studio-likes-header]')) {
				continue;
			}

			const commentsHeader = findDirectChildByClass(
				header,
				'tablecell-comments'
			);

			if (!commentsHeader) {
				continue;
			}

			const likesHeader = commentsHeader.cloneNode(false);

			likesHeader.dataset.studioLikesHeader = '1';
			likesHeader.classList.remove('tablecell-comments');
			likesHeader.classList.remove('right-align');
			likesHeader.classList.add(
				'tablecell-likes',
				'studio-likes-header'
			);
			applyColumnWidth(likesHeader);

			const title = document.createElement('h3');
			title.className = 'header-name style-scope ytcp-table-header';

			const text = document.createElement('span');
			text.className = 'style-scope ytcp-table-header';
			text.textContent = 'Likes (vs. dislikes)';

			title.append(text);
			likesHeader.append(title);

			commentsHeader.classList.add('studio-likes-after-comments');
			commentsHeader.insertAdjacentElement('afterend', likesHeader);
		}
	}

	function getVideoIdFromRow(row) {
		const link = row.querySelector(
			'a#video-title[href*="/video/"], a#thumbnail-anchor[href*="/video/"]'
		);

		if (!link) {
			return null;
		}

		try {
			const path = new URL(link.href, location.origin).pathname;
			return path.match(/^\/video\/([^/]+)\//)?.[1] ?? null;
		} catch {
			return null;
		}
	}

	function ensureCell(row) {
		let cell = row.querySelector('[data-studio-likes-cell]');

		if (cell) {
			return cell;
		}

		const commentsCell = row.querySelector('.tablecell-comments');

		if (!commentsCell) {
			return null;
		}

		cell = commentsCell.cloneNode(false);
		cell.dataset.studioLikesCell = '1';
		cell.classList.remove('tablecell-comments');
		cell.classList.remove('right-align');
		cell.classList.add('tablecell-likes', 'studio-likes-cell');
		applyColumnWidth(cell);

		commentsCell.classList.add('studio-likes-after-comments');
		commentsCell.insertAdjacentElement('afterend', cell);

		return cell;
	}

	function clearCellState(cell) {
		cell.replaceChildren();
		cell.removeAttribute('title');
		cell.removeAttribute('aria-label');
	}

	function renderUnavailable(cell) {
		clearCellState(cell);

		const text = document.createElement('span');
		text.className = 'studio-likes-singleline';
		text.textContent = '—';

		cell.title = 'Rating data was not returned by YouTube Studio';
		cell.setAttribute(
			'aria-label',
			'Rating data was not returned by YouTube Studio'
		);

		cell.append(text);
	}

	function renderPublicOnly(cell, likes) {
		clearCellState(cell);

		const content = document.createElement('div');
		content.className = 'studio-likes-content';

		const likesText = document.createElement('div');
		likesText.className = 'studio-likes-count';
		likesText.textContent = `${compactNumber.format(likes)} like${likes === 1 ? '' : 's'}`;

		const missingText = document.createElement('div');
		missingText.className = 'studio-likes-empty';
		missingText.textContent = '—';

		content.append(missingText, likesText);

		cell.title = `${fullNumber.format(
			likes
		)} likes; dislike count was not returned`;

		cell.setAttribute('aria-label',
			`${fullNumber.format(likes)} likes. Dislike count was not returned`);

		cell.append(content);
	}

	function renderNoRatings(cell) {
		clearCellState(cell);

		const text = document.createElement('span');
		text.className = 'studio-likes-singleline';
		text.textContent = '—';

		cell.title = '0 likes · 0 dislikes';
		cell.setAttribute('aria-label', '—');
		cell.append(text);
	}

	function renderPrivateMetrics(cell, likes, dislikes) {
		clearCellState(cell);
		const total = likes + dislikes;

		if (total <= 0) {
			renderNoRatings(cell);
			return;
		}

		const likePercent = (likes / total) * 100;
		const content = document.createElement('div');
		content.className = 'studio-likes-content';

		const percentText = document.createElement('div');
		percentText.className = 'studio-likes-percent';
		percentText.textContent = `${likePercent.toFixed(1)}%`;

		const likesText = document.createElement('div');
		likesText.className = 'studio-likes-count';
		likesText.textContent = `${compactNumber.format(likes)} like${likes === 1 ? '' : 's'}`;

		const bar = document.createElement('div');
		bar.className = 'studio-likes-bar';

		const positivePart = document.createElement('span');
		positivePart.className = 'studio-likes-bar-positive';
		positivePart.style.width = `${Math.max(1, likePercent)}%`;

		bar.append(positivePart);
		content.append(percentText, likesText, bar);

		cell.title = `${fullNumber.format(likes)} likes · ` +
			`${fullNumber.format(dislikes)} dislikes`;

		cell.setAttribute('aria-label',
			`${likePercent.toFixed(1)}% likes. ` +
			`${fullNumber.format(likes)} likes and ` +
			`${fullNumber.format(dislikes)} dislikes`);

		cell.append(content);
	}

	function updateCell(cell, videoId) {
		const rating = videoId ? ratings.get(videoId) : null;
		const signature = rating
			? `${videoId}:${rating.source}:${rating.likes ?? ''}:${rating.dislikes ?? ''}`
			: `${videoId ?? ''}:missing`;

		if (cell.dataset.studioLikesSignature === signature) {
			return;
		}

		cell.dataset.studioLikesSignature = signature;

		if (!rating) {
			renderUnavailable(cell);
			return;
		}

		if (rating.source === 'private' &&
			rating.likes !== null &&
			rating.dislikes !== null) {
			renderPrivateMetrics(cell, rating.likes, rating.dislikes);
			return;
		}

		if (rating.likes !== null) {
			renderPublicOnly(cell, rating.likes);
			return;
		}

		renderUnavailable(cell);
	}

	function render() {
		renderQueued = false;
		installStyles();
		ensureHeader();

		for (const row of document.querySelectorAll('ytcp-video-row[role="row"]')) {
			const cell = ensureCell(row);

			if (!cell) {
				continue;
			}

			updateCell(cell, getVideoIdFromRow(row));
		}
	}

	function scheduleRender() {
		if (renderQueued) {
			return;
		}

		renderQueued = true;
		requestAnimationFrame(render);
	}

	function startDomObserver() {
		if (!document.documentElement) {
			queueMicrotask(startDomObserver);
			return;
		}

		const observer = new MutationObserver(scheduleRender);

		observer.observe(document.documentElement, {
			childList: true,
			subtree: true,
		});

		document.addEventListener('yt-navigate-finish', scheduleRender, true);
		document.addEventListener('yt-page-data-updated', scheduleRender, true);

		scheduleRender();
	}

	startDomObserver();
})();