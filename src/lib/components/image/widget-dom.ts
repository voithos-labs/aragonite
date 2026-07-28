// Image widget contributes its raw bytes via data-source-start / data-source-end
// — `cursor/widget-offset.ts` reads them. textContent stays empty so prose
// `textContent === ambientPrefix + raw` still holds.

import type { InlineNode } from '../../core/nodes';
import type { ImageLoadPolicy } from '../../core/inline-render';
import { isAllowedImageSrcScheme } from '../../core/url-policy';
import { findBlockPathForElement } from '../../selection/path-lookup';
import { devWarn } from '../../dev-warn';

export interface BuildImageWidgetOpts {
	resolveImageUrl: (rawUrl: string) => string;
	imageLoadPolicy?: ImageLoadPolicy;
	/**
	 * Resolved URLs that failed to load this session, scoped per editor instance.
	 * Inline rebuild on every keystroke creates a fresh <img>; without this cache
	 * the new widget renders without `md-image-broken` until the async `error`
	 * event re-fires, producing a visible layout flicker (no min-width/min-height,
	 * no dashed border) on each keystroke in a paragraph with a broken image.
	 */
	brokenUrlCache: Set<string>;
}

export function buildImageWidget(
	node: InlineNode,
	_raw: string,
	opts: BuildImageWidgetOpts
): HTMLSpanElement {
	const widget = document.createElement('span');
	widget.className = 'md-image-widget';
	// `data-inline-widget` is the shared atomic-widget marker (cursor walker,
	// selection painter, raw reader); `data-image-widget` is image-specific.
	widget.dataset.inlineWidget = '';
	widget.dataset.imageWidget = '';
	widget.dataset.sourceStart = String(node.start);
	widget.dataset.sourceEnd = String(node.end);
	widget.setAttribute('contenteditable', 'false');

	// Select on `click`, never `pointerdown`. A pointerdown listener that stops
	// propagation (or one that selects on press) hijacks a gesture STARTING on the
	// image: the block never sees the pointerdown, so no cross-block drag or
	// Shift-click extension can originate here, and selecting on press mounts the
	// overlay that then covers the block a drag is heading into. `click` fires only
	// on a press-and-release in place — a drag off the widget produces none — so the
	// pointerdown bubbles untouched to the block's cross-block handler and only a
	// genuine click selects the image. A Shift-click is a cross-block extension the
	// block owns, so decline the select (it would clear the extension).
	widget.addEventListener('click', (e) => {
		if (e.shiftKey) return;
		// Resolve the paragraph path live from the enclosing block-host instead
		// of baking it at build time. A block's path shifts whenever content is
		// inserted/removed above it — its `raw` (and so this widget's DOM) is
		// untouched, so the render memo skips a rebuild and a baked path would go
		// stale, making click-to-select resolve the wrong CST node. The host's
		// `data-block-path` is kept reactively in sync.
		const paragraphPath = findBlockPathForElement(widget);
		if (!paragraphPath) return;
		// Click-snap consistently lands the caret at the widget's right
		// edge (see TextEditableBlock.snapClickToWidgetEdge) — match that
		// for the undo anchor so Ctrl+Z restores the click's visual landing.
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
	// A default-draggable <img> starts a native HTML5 drag on pointerdown, which
	// swallows the pointermove stream — a cross-block drag that begins on the image
	// would never reach the block's drag listener.
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
	// Only an image we actually loaded can be broken. A blocked/placeholder
	// widget leaves src unset, and an unset <img> reports complete && naturalWidth
	// === 0 in a real browser — without this guard those would render as broken.
	if (
		img.src &&
		(opts.brokenUrlCache.has(resolvedUrl) || (img.complete && img.naturalWidth === 0))
	) {
		widget.classList.add('md-image-broken');
	}
	img.addEventListener('error', () => {
		opts.brokenUrlCache.add(resolvedUrl);
		widget.classList.add('md-image-broken');
	});
	img.addEventListener('load', () => {
		if (img.naturalWidth > 0) {
			opts.brokenUrlCache.delete(resolvedUrl);
			widget.classList.remove('md-image-broken');
		}
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
