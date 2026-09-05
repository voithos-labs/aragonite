// The widget contributes its raw bytes via data-source-start/end, which
// `cursor/widget-offset.ts` reads; textContent stays empty so prose
// `textContent === ambientPrefix + raw` still holds.

import type { InlineNode } from '../../core/nodes';
import type { ImageLoadPolicy } from '../../core/inline-render';
import { isAllowedImageSrcScheme } from '../../core/url-policy';
import { findSurfacePathForElement } from '../../selection/path-lookup';
import { devWarn } from '../../dev-warn';

export interface BuildImageWidgetOpts {
	resolveImageUrl: (rawUrl: string) => string;
	imageLoadPolicy?: ImageLoadPolicy;
	/** Resolved URLs that failed to load this session, per editor instance. Inline
	 *  rebuild creates a fresh <img> per keystroke, which without this renders
	 *  unbroken until the async `error` re-fires — a flicker on every keystroke. */
	brokenUrlCache: Set<string>;
}

export function buildImageWidget(
	node: InlineNode,
	_raw: string,
	opts: BuildImageWidgetOpts
): HTMLSpanElement {
	const widget = document.createElement('span');
	widget.className = 'md-image-widget';
	// `data-inline-widget` is the shared atomic-widget marker read by the cursor
	// walker, selection painter and raw reader; `data-image-widget` is image-specific.
	widget.dataset.inlineWidget = '';
	widget.dataset.imageWidget = '';
	widget.dataset.sourceStart = String(node.start);
	widget.dataset.sourceEnd = String(node.end);
	widget.setAttribute('contenteditable', 'false');

	// Select on `click`, never `pointerdown`: a pointerdown listener hijacks a gesture
	// STARTING on the image, so no cross-block drag could originate here. Shift-click
	// is a cross-block extension the block owns, so decline it.
	widget.addEventListener('click', (e) => {
		if (e.shiftKey) return;
		// Resolve the path live rather than baking it at build time: content inserted
		// above shifts the block's path without touching its `raw`, so the render memo
		// skips a rebuild and a baked path resolves the wrong CST node. The SURFACE door:
		// inside a cell the block path stops at the table, whose offsets are cell indices.
		const paragraphPath = findSurfacePathForElement(widget);
		if (!paragraphPath) return;
		// Match TextEditableBlock.snapClickToWidgetEdge, which lands the caret at the
		// widget's right edge, so Ctrl+Z restores the click's visual landing.
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
	// A declared `|WxH` box belongs to the author, so it both reserves space before the bytes
	// arrive and survives the decode: the attribute pair alone loses to the natural ratio the
	// moment `height: auto` has one to read.
	if (node.width !== undefined && node.height !== undefined) {
		img.style.aspectRatio = `${node.width} / ${node.height}`;
	}
	const markBroken = (): void => {
		opts.brokenUrlCache.add(resolvedUrl);
		widget.classList.add('md-image-broken');
	};
	// Broken means the request finished and produced nothing to lay out, so each site
	// establishes completion itself: `complete` here, by definition in the load listener.
	const hasNoIntrinsicSize = (): boolean => img.naturalWidth === 0;
	// Only a loaded image can be broken: a blocked/placeholder widget leaves src unset,
	// and an unset <img> reports complete && naturalWidth === 0 in a real browser.
	if (img.src && (opts.brokenUrlCache.has(resolvedUrl) || (img.complete && hasNoIntrinsicSize()))) {
		markBroken();
	}
	img.addEventListener('error', markBroken);
	// A load event is not proof of success: a 200 the decoder cannot size (truncated
	// body, an SVG with no intrinsic dimensions) fires `load` with naturalWidth 0, and
	// deferring that to the next rebuild leaves the placeholder a render behind.
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
