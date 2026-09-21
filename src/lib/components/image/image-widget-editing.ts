/**
 * What a key does while an image widget is selected: Shift+Arrow resizes it. Registered as
 * the image kind's `onSelectedKey` at mount (built-in-blocks.ts), so the shared
 * selected-widget keydown path stays the same for every kind.
 */

import type { InlineWidgetEditingContext } from '../../core/inline/inline-widgets';
import type { ImageFields } from '../../core/nodes';
import { buildImageEditBytes } from './image-source-bytes';
import { keyboardResizeWidth } from './image-resize';

const KEYBOARD_STEP = 20;
const FALLBACK_DEFAULT_WIDTH = 400;

export function imageWidgetOnSelectedKey(
	e: KeyboardEvent,
	ctx: InlineWidgetEditingContext
): boolean {
	// A resize is an edit; refusing here lets the caller swallow the key and do nothing.
	if (ctx.presentationMode === 'reading') return false;
	if (!(e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))) return false;
	e.preventDefault();

	const { inline, node } = ctx;
	const delta = e.key === 'ArrowRight' ? KEYBOARD_STEP : -KEYBOARD_STEP;
	const currentWidth = inline.width ?? FALLBACK_DEFAULT_WIDTH;
	const newWidth = keyboardResizeWidth(currentWidth, delta, ctx.editorContentWidth);

	// The url and title are untouched, so keep the label and the `![alt][label]` form
	// rather than writing the resolved url inline.
	const newFields: ImageFields = {
		alt: inline.alt ?? '',
		url: inline.url ?? '',
		...(inline.title !== undefined ? { title: inline.title } : {}),
		width: newWidth,
		...(inline.height !== undefined
			? { height: Math.round((newWidth / currentWidth) * inline.height) }
			: {}),
		...(inline.crop !== undefined ? { crop: inline.crop } : {}),
		...(inline.label !== undefined ? { label: inline.label } : {})
	};
	const newBytes = buildImageEditBytes(inline, node.raw, newFields);
	// The inline syntax handler that owns these bytes cannot express the resize, but take
	// the key anyway: passing a Shift+Arrow on would extend the selection out of the image.
	if (newBytes === null) return true;
	const newRaw = node.raw.slice(0, ctx.widgetStart) + newBytes + node.raw.slice(ctx.widgetEnd);
	ctx.updateContent(newRaw, ctx.preSelectOffset, ctx.widgetStart + newBytes.length);
	return true;
}
