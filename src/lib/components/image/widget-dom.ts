// The widget reports its raw bytes through data-source-start and data-source-end, which
// `cursor/widget-offset.ts` reads; its textContent stays empty so a prose block's
// `textContent === marker prefix + raw` still holds.

import type { InlineNode } from '../../core/nodes';
import type { ImageLoadPolicy } from '../../core/inline-render';
import { isAllowedImageSrcScheme } from '../../core/url-policy';
import { findSurfacePathForElement } from '../../selection/path-lookup';
import { devWarn } from '../../dev-warn';
import { applyCropToWidget } from './image-crop';

export interface BuildImageWidgetOpts {
	resolveImageUrl: (rawUrl: string) => string;
	imageLoadPolicy?: ImageLoadPolicy;
	/** Resolved URLs that failed to load this session, one set per editor instance. An
	 *  inline rebuild creates a fresh <img> per keystroke, which without this renders
	 *  unbroken until the async `error` fires again: a flicker on every keystroke. */
	brokenUrlCache: Set<string>;
}

export function buildImageWidget(
	node: InlineNode,
	_raw: string,
	opts: BuildImageWidgetOpts
): HTMLSpanElement {
	const widget = document.createElement('span');
	widget.className = 'md-image-widget';
	// `data-inline-widget` marks any widget the caret cannot enter, and is read by the
	// caret code, the selection painter and the raw reader; `data-image-widget` is this one.
	widget.dataset.inlineWidget = '';
	widget.dataset.imageWidget = '';
	widget.dataset.sourceStart = String(node.start);
	widget.dataset.sourceEnd = String(node.end);
	widget.setAttribute('contenteditable', 'false');

	// Select on `click`, never `pointerdown`: a pointerdown listener would take over a
	// gesture that starts on the image, so no cross-block drag could begin here.
	// Shift-click extends a cross-block selection, which the block owns, so leave it.
	widget.addEventListener('click', (e) => {
		if (e.shiftKey) return;
		// Resolve the path on the click rather than baking it in at build time: content
		// inserted above shifts the block's path without touching its `raw`, so the render
		// cache skips a rebuild and a baked path would find the wrong CST node. It resolves
		// the editable block: inside a cell the path stops at the table, whose offsets are
		// cell indices.
		const paragraphPath = findSurfacePathForElement(widget);
		if (!paragraphPath) return;
		// Match TextEditableBlock.snapClickToWidgetEdge, which puts the caret at the
		// widget's right edge, so Ctrl+Z restores the caret where the click left it.
		const event = new CustomEvent('image-widget-select', {
			bubbles: true,
			detail: {
				paragraphPath,
				sourceStart: node.start,
				preSelectOffset: node.end
			}
		});
		widget.dispatchEvent(event);
	});

	const img = document.createElement('img');
	// A default-draggable <img> starts a native HTML5 drag that swallows the
	// pointermove stream a cross-block drag needs.
	img.draggable = false;
	img.alt = node.alt ?? '';
	const resolvedUrl = safeResolve(opts.resolveImageUrl, node.url ?? '');
	const policy = opts.imageLoadPolicy ?? 'auto';
	if (!isAllowedImageSrcScheme(resolvedUrl)) {
		widget.classList.add('md-image-blocked');
	} else if (policy === 'placeholder') {
		widget.classList.add('md-image-placeholder');
	} else {
		img.src = resolvedUrl;
	}
	if (node.title) img.title = node.title;
	if (node.width !== undefined) img.setAttribute('width', String(node.width));
	if (node.height !== undefined) img.setAttribute('height', String(node.height));
	// A `|WxH` box written in the source belongs to the author, so it both reserves space before
	// the bytes arrive and survives the decode: the two attributes alone lose to the natural
	// ratio once `height: auto` has one to read. With a crop, that box is a frame to pan in.
	if (node.width !== undefined && node.height !== undefined) {
		img.style.aspectRatio = `${node.width} / ${node.height}`;
		if (node.crop) {
			applyCropToWidget(widget, img, { width: node.width, height: node.height }, node.crop);
		}
	}
	const markBroken = (): void => {
		opts.brokenUrlCache.add(resolvedUrl);
		widget.classList.add('md-image-broken');
	};
	// Broken means the request finished and produced nothing to lay out, so each place
	// below checks that it finished: `complete` here, and the load event itself below.
	const hasNoIntrinsicSize = (): boolean => img.naturalWidth === 0;
	// Only a loaded image can be broken: a blocked or placeholder widget leaves src unset,
	// and an unset <img> reports complete with naturalWidth 0 in a real browser.
	if (img.src && (opts.brokenUrlCache.has(resolvedUrl) || (img.complete && hasNoIntrinsicSize()))) {
		markBroken();
	}
	img.addEventListener('error', markBroken);
	// A load event is not proof of success: a 200 the decoder cannot size (a truncated
	// body, an SVG with no dimensions of its own) fires `load` with naturalWidth 0, and
	// leaving that to the next rebuild leaves the placeholder a render behind.
	img.addEventListener('load', () => {
		if (hasNoIntrinsicSize()) {
			markBroken();
			return;
		}
		opts.brokenUrlCache.delete(resolvedUrl);
		widget.classList.remove('md-image-broken');
	});
	widget.appendChild(img);

	return widget;
}

function safeResolve(resolver: (u: string) => string, url: string): string {
	try {
		const out = resolver(url);
		if (typeof out !== 'string') {
			devWarn('image-widget', 'resolveImageUrl returned non-string; falling back to raw URL');
			return url;
		}
		return out;
	} catch (e) {
		devWarn('image-widget', 'resolveImageUrl threw', e);
		return url;
	}
}
