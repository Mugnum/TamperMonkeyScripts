// ==UserScript==
// @name			YouTube Studio: Restore Likes/Dislikes Column
// @description		Restores a likes/dislikes column in YouTube Studio Content
// @version			2.1.1
// @namespace		Mugnum.Scripts.YouTube.StudioRestoreLikes
// @author			Mugnum
// @license			MIT License
// @icon			https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @downloadURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/youtube-studio-restore-likes-column.user.js
// @updateURL		https://raw.githubusercontent.com/Mugnum/TamperMonkeyScripts/main/Scripts/youtube-studio-restore-likes-column.user.js
// @match			https://studio.youtube.com/*
// @run-at			document-start
// @grant			none
// @noframes
// ==/UserScript==

(() => {
	'use strict';

	const LIST_CREATOR_VIDEOS = '/youtubei/v1/creator/list_creator_videos';
	const YTA_JOIN = '/youtubei/v1/yta_web/join';
	const MAX_BATCH_SIZE = 50;
	const MAX_ATTEMPTS = 3;
	const RETRY_DELAY = 750;

	const ratings = new Map();
	const publicLikes = new Map();
	const pending = new Set();

	const fullNumber = new Intl.NumberFormat();
	const compactNumber = new Intl.NumberFormat(undefined, {
		notation: 'compact',
		maximumFractionDigits: 1,
	});

	let renderQueued = false;

	const nativeXhrOpen = XMLHttpRequest.prototype.open;
	const nativeXhrSend = XMLHttpRequest.prototype.send;
	const nativeXhrSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

	function parseCount(value) {
		const count = Number(value);
		return Number.isFinite(count) && count >= 0 ? count : null;
	}

	function parseJson(value) {
		try {
			return JSON.parse(value);
		}
		catch {
			return null;
		}
	}

	function isVideoListRequest(url) {
		return String(url).includes(LIST_CREATOR_VIDEOS);
	}

	function getVideoIds(payload) {
		if (!Array.isArray(payload?.videos)) {
			return [];
		}

		return [...new Set(
			payload.videos
				.map(video => video?.videoId)
				.filter(videoId => typeof videoId === 'string')
		)];
	}

	function ingestPublicLikes(payload) {
		if (!Array.isArray(payload?.videos)) {
			return;
		}

		for (const video of payload.videos) {
			if (typeof video?.videoId !== 'string') {
				continue;
			}

			const likes = parseCount(video.publicMetrics?.likeCount);

			if (likes !== null) {
				publicLikes.set(video.videoId, likes);
			}
		}

		scheduleRender();
	}

	function makeAnalyticsUrl(listUrl) {
		const origin = new URL(listUrl, location.href).origin;
		return `${origin}${YTA_JOIN}?alt=json`;
	}

	function buildAnalyticsRequest(context, videoIds) {
		return {
			context,
			nodes: [
				{
					key: 'ratings',
					value: {
						query: {
							dimensions: [
								{
									type: 'VIDEO',
								},
							],
							metrics: [
								{
									type: 'RATINGS_LIKES',
								},
								{
									type: 'RATINGS_DISLIKES',
								},
							],
							restricts: [
								{
									dimension: {
										type: 'VIDEO',
									},
									inValues: videoIds,
								},
							],
							orders: [],
							timeRange: {
								unboundedRange: {},
							},
							returnDataInNewFormat: true,
							limitedToBatchedData: false,
							useMultiFormatArtistAnalytics: false,
						},
					},
				},
			],
			connectors: [],
			allowFailureResultNodes: true,
		};
	}

	function ingestAnalytics(payload, requestedVideoIds) {
		const result = payload?.results?.find(result => result?.key === 'ratings') ?? payload?.results?.[0];
		const table = result?.value?.resultTable;

		if (!table) {
			return false;
		}

		const videoColumn = table.dimensionColumns?.find(column => column?.dimension?.type === 'VIDEO')
			?? table.dimensionColumns?.[0];

		const likesColumn = table.metricColumns?.find(column => column?.metric?.type === 'RATINGS_LIKES');
		const dislikesColumn = table.metricColumns?.find(column => column?.metric?.type === 'RATINGS_DISLIKES');

		if (!likesColumn || !dislikesColumn) {
			return false;
		}

		let videoIds = videoColumn?.strings?.values ?? [];
		const likes = likesColumn.counts?.values ?? [];
		const dislikes = dislikesColumn.counts?.values ?? [];

		if (!videoIds.length && requestedVideoIds.length === 1 && (likes.length || dislikes.length)) {
			videoIds = requestedVideoIds;
		}

		if (!videoIds.length && (likes.length || dislikes.length)) {
			return false;
		}

		const returned = new Map();

		for (let index = 0; index < videoIds.length; index++) {
			const videoId = videoIds[index];

			if (typeof videoId !== 'string') {
				continue;
			}

			returned.set(videoId, {
				likes: parseCount(likes[index]) ?? 0,
				dislikes: parseCount(dislikes[index]) ?? 0,
			});
		}

		for (const videoId of requestedVideoIds) {
			const rating = returned.get(videoId);

			ratings.set(videoId, {
				likes: rating?.likes ?? 0,
				dislikes: rating?.dislikes ?? 0,
			});
		}

		scheduleRender();
		return true;
	}

	function postJson(url, body, headers) {
		return new Promise((resolve, reject) => {
			const xhr = new XMLHttpRequest();

			xhr.timeout = 15000;
			nativeXhrOpen.call(xhr, 'POST', url, true);

			let hasContentType = false;

			for (const [name, value] of headers) {
				if (name.toLowerCase() === 'content-type') {
					hasContentType = true;
				}

				try {
					nativeXhrSetRequestHeader.call(xhr, name, value);
				}
				catch {
				}
			}

			if (!hasContentType) {
				nativeXhrSetRequestHeader.call(xhr, 'Content-Type', 'application/json');
			}

			xhr.addEventListener('load', () => {
				resolve({
					status: xhr.status,
					payload: parseJson(xhr.responseText),
					retryAfter: Number(xhr.getResponseHeader('Retry-After')),
				});
			}, {
				once: true,
			});

			xhr.addEventListener('error', reject, {
				once: true,
			});

			xhr.addEventListener('timeout', reject, {
				once: true,
			});

			nativeXhrSend.call(xhr, JSON.stringify(body));
		});
	}

	function wait(milliseconds) {
		return new Promise(resolve => setTimeout(resolve, milliseconds));
	}

	async function requestAnalytics(listUrl, context, videoIds, headers) {
		const unresolved = videoIds.filter(videoId =>
			!ratings.has(videoId) &&
			!pending.has(videoId)
		);

		if (!unresolved.length) {
			return;
		}

		for (const videoId of unresolved) {
			pending.add(videoId);
		}

		scheduleRender();

		try {
			const url = makeAnalyticsUrl(listUrl);
			const body = buildAnalyticsRequest(context, unresolved);

			for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
				try {
					const response = await postJson(url, body, headers);

					if (response.status === 200 && response.payload) {
						ingestAnalytics(response.payload, unresolved);
						return;
					}

					const retryable = response.status === 0 ||
						response.status === 429 ||
						response.status >= 500;

					if (!retryable || attempt === MAX_ATTEMPTS - 1) {
						return;
					}

					const retryAfter = Number.isFinite(response.retryAfter) && response.retryAfter > 0
						? response.retryAfter * 1000
						: RETRY_DELAY * (2 ** attempt);

					await wait(retryAfter);
				}
				catch {
					if (attempt === MAX_ATTEMPTS - 1) {
						return;
					}

					await wait(RETRY_DELAY * (2 ** attempt));
				}
			}
		}
		finally {
			for (const videoId of unresolved) {
				pending.delete(videoId);
			}

			scheduleRender();
		}
	}

	function requestPageAnalytics(listUrl, request, response, headers) {
		if (!request?.context) {
			return;
		}

		const videoIds = getVideoIds(response);

		for (let index = 0; index < videoIds.length; index += MAX_BATCH_SIZE) {
			requestAnalytics(
				listUrl,
				request.context,
				videoIds.slice(index, index + MAX_BATCH_SIZE),
				headers
			);
		}
	}

	XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
		this.__studioLikesUrl = String(url);
		this.__studioLikesIsVideoList = isVideoListRequest(url);
		this.__studioLikesHeaders = this.__studioLikesIsVideoList ? [] : null;

		return nativeXhrOpen.apply(this, arguments);
	};

	XMLHttpRequest.prototype.setRequestHeader = function patchedSetRequestHeader(name, value) {
		if (this.__studioLikesIsVideoList) {
			this.__studioLikesHeaders.push([
				String(name),
				String(value),
			]);
		}

		return nativeXhrSetRequestHeader.apply(this, arguments);
	};

	XMLHttpRequest.prototype.send = function patchedSend(body) {
		if (this.__studioLikesIsVideoList) {
			const request = parseJson(body);

			this.addEventListener('load', function onLoad() {
				const response = this.responseType === 'json'
					? this.response
					: parseJson(this.responseText);

				if (!response) {
					return;
				}

				ingestPublicLikes(response);

				requestPageAnalytics(
					this.__studioLikesUrl,
					request,
					response,
					this.__studioLikesHeaders
				);
			}, {
				once: true,
			});
		}

		return nativeXhrSend.call(this, body);
	};

	function installStyles() {
		const style = document.createElement('style');

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
			}

			.studio-likes-bar-positive {
				display: block;
				height: 100%;
				border-radius: inherit;
				opacity: 0.82;
				background: var(--ytcp-text-secondary);
			}

			.studio-likes-singleline {
				width: min(100%, 112px);
				max-width: 112px;
				margin-left: auto;
				margin-right: 12px;
				transform: translateY(-18px);
				text-align: right;
				color: var(--ytcp-text-secondary);
				font-size: 12px;
				line-height: 18px;
				white-space: nowrap;
			}
		`;

		(document.head || document.documentElement).append(style);
	}

	function createElement(tag, className, text) {
		const element = document.createElement(tag);

		if (className) {
			element.className = className;
		}

		if (text !== undefined) {
			element.textContent = text;
		}

		return element;
	}

	function findDirectChildByClass(parent, className) {
		return [...parent.children].find(element => element.classList?.contains(className));
	}

	function ensureHeader() {
		for (const header of document.querySelectorAll('ytcp-table-header#table-header')) {
			if (header.querySelector('[data-studio-likes-header]')) {
				continue;
			}

			const commentsHeader = findDirectChildByClass(header, 'tablecell-comments');

			if (!commentsHeader) {
				continue;
			}

			const likesHeader = commentsHeader.cloneNode(false);

			likesHeader.removeAttribute('style');
			likesHeader.dataset.studioLikesHeader = '1';
			likesHeader.classList.remove('tablecell-comments', 'right-align');
			likesHeader.classList.add('tablecell-likes', 'studio-likes-header');

			const title = createElement('h3', 'header-name style-scope ytcp-table-header');
			const text = createElement('span', 'style-scope ytcp-table-header', 'Likes (vs. dislikes)');

			title.append(text);
			likesHeader.append(title);
			commentsHeader.insertAdjacentElement('afterend', likesHeader);
		}
	}

	function getVideoId(row) {
		const link = row.querySelector(
			'a#video-title[href*="/video/"], a#thumbnail-anchor[href*="/video/"]'
		);

		if (!link) {
			return null;
		}

		try {
			return new URL(link.href, location.origin).pathname
				.match(/^\/video\/([^/]+)\//)?.[1] ?? null;
		}
		catch {
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

		cell.removeAttribute('style');
		cell.dataset.studioLikesCell = '1';
		cell.classList.remove('tablecell-comments', 'right-align');
		cell.classList.add('tablecell-likes', 'studio-likes-cell');

		commentsCell.insertAdjacentElement('afterend', cell);

		return cell;
	}

	function clearCell(cell) {
		cell.replaceChildren();
		cell.removeAttribute('title');
		cell.removeAttribute('aria-label');
	}

	function renderDash(cell, title) {
		clearCell(cell);
		cell.append(createElement('span', 'studio-likes-singleline', '—'));
		cell.title = title;
	}

	function renderLoading(cell) {
		clearCell(cell);
		cell.append(createElement('span', 'studio-likes-singleline', '—'));
	}

	function renderPublicLikes(cell, likes) {
		clearCell(cell);

		const content = createElement('div', 'studio-likes-content');
		const missing = createElement('div', null, '—');
		const likesText = createElement(
			'div',
			'studio-likes-count',
			`${compactNumber.format(likes)} like${likes === 1 ? '' : 's'}`
		);

		content.append(missing, likesText);
		cell.append(content);
		cell.title = `${fullNumber.format(likes)} likes; dislike count unavailable`;
	}

	function renderRatings(cell, likes, dislikes) {
		const total = likes + dislikes;

		if (total === 0) {
			renderDash(cell, '0 likes · 0 dislikes');
			return;
		}

		clearCell(cell);

		const percent = (likes / total) * 100;
		const content = createElement('div', 'studio-likes-content');
		const percentText = createElement('div', 'studio-likes-percent', `${percent.toFixed(1)}%`);
		const likesText = createElement(
			'div',
			'studio-likes-count',
			`${compactNumber.format(likes)} like${likes === 1 ? '' : 's'}`
		);

		const bar = createElement('div', 'studio-likes-bar');
		const positive = createElement('span', 'studio-likes-bar-positive');

		positive.style.width = `${percent}%`;

		bar.append(positive);
		content.append(percentText, likesText, bar);
		cell.append(content);

		cell.title = `${fullNumber.format(likes)} likes · ${fullNumber.format(dislikes)} dislikes`;
		cell.setAttribute(
			'aria-label',
			`${percent.toFixed(1)}% likes. ${fullNumber.format(likes)} likes and ${fullNumber.format(dislikes)} dislikes`
		);
	}

	function updateCell(cell, videoId) {
		const rating = ratings.get(videoId);
		const isPending = pending.has(videoId);
		const hasPublicLikes = publicLikes.has(videoId);
		const likes = publicLikes.get(videoId);

		const signature = rating
			? `${videoId}:${rating.likes}:${rating.dislikes}`
			: isPending
				? `${videoId}:pending`
				: hasPublicLikes
					? `${videoId}:public:${likes}`
					: `${videoId}:missing`;

		if (cell.dataset.studioLikesSignature === signature) {
			return;
		}

		cell.dataset.studioLikesSignature = signature;

		if (rating) {
			renderRatings(cell, rating.likes, rating.dislikes);
			return;
		}

		if (isPending) {
			renderLoading(cell);
			return;
		}

		if (hasPublicLikes) {
			renderPublicLikes(cell, likes);
			return;
		}

		renderDash(cell, 'Rating data unavailable');
	}

	function render() {
		renderQueued = false;

		ensureHeader();

		for (const row of document.querySelectorAll('ytcp-video-row[role="row"]')) {
			const cell = ensureCell(row);

			if (!cell) {
				continue;
			}

			updateCell(cell, getVideoId(row));
		}
	}

	function scheduleRender() {
		if (renderQueued) {
			return;
		}

		renderQueued = true;
		requestAnimationFrame(render);
	}

	function start() {
		if (!document.documentElement) {
			queueMicrotask(start);
			return;
		}

		installStyles();

		new MutationObserver(scheduleRender).observe(document.documentElement, {
			childList: true,
			subtree: true,
		});

		document.addEventListener('yt-navigate-finish', scheduleRender, true);
		document.addEventListener('yt-page-data-updated', scheduleRender, true);

		scheduleRender();
	}

	start();
})();
