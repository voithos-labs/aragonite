/**
 * The image widget's selected-key behavior: Shift+Arrow keyboard resize. Attached
 * as the image kind's `onSelectedKey` at editor mount (built-in-blocks.ts), so the
 * generic selected-widget keydown path stays kind-agnostic.
 */

import type { InlineWidgetEditingContext } from '../../core/inline/inline-widgets';
import { buildImageSourceBytes, type ImageFields } from './image-source-bytes';
import { keyboardResizeWidth } from './image-resize';

const KEYBOARD_STEP = 20;
const FALLBACK_DEFAULT_WIDTH = 400;

export function imageWidgetOnSelectedKey(
	e: KeyboardEvent,
	ctx: InlineWidgetEditingContext
): boolean {
	// A resize is an edit; declining lets the caller's generic swallow keep the key inert.
	if (ctx.presentationMode === 'reading') return false;
	if (!(e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))) return false;
	e.preventDefault();

	const { inline, node } = ctx;
	const delta = e.key === 'ArrowRight' ? KEYBOARD_STEP : -KEYBOARD_STEP;
	const currentWidth = inline.width ?? FALLBACK_DEFAULT_WIDTH;
	const newWidth = keyboardResizeWidth(currentWidth, delta, ctx.editorContentWidth);

	// A keyboard resize only changes width/height — url and title are untouched — so
	// carry the reference label through to preserve the `![alt][label]` form rather
	// than inlining the LRD-resolved url.
	const newFields: ImageFields = {
		alt: inline.alt ?? '',
		url: inline.url ?? '',
		...(inline.title !== undefined ? { title: inline.title } : {}),
		width: newWidth,
		...(inline.height !== undefined
			? { height: Math.round((newWidth / currentWidth) * inline.height) }
			: {}),
		...(inline.label !== undefined ? { label: inline.label } : {})
	};
	const newBytes = buildImageSourceBytes(newFields);
	const newRaw = node.raw.slice(0, ctx.widgetStart) + newBytes + node.raw.slice(ctx.widgetEnd);
	ctx.updateContent(newRaw, ctx.preSelectOffset, ctx.widgetStart + newBytes.length);
	return true;
}
