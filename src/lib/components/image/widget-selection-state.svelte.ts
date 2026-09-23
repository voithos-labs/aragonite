// A selected image never coexists with a document caret or range: `select` fires `onSelect` so
// the editor clears them, a cross-block range clears the image, and the editor's selectionchange
// listener drops a caret the browser puts in a block while an image is selected.

import { pathsEqual } from '../../selection/path-math';
import { findSurfacePathForElement } from '../../selection/path-lookup';

/** What a click-outside handler must not count as outside: the widget itself and the overlay
 *  controls attached to it. */
export const IMAGE_CHROME_SELECTOR = '[data-image-widget], [data-image-overlay]';

/** Whether a press should end the image selection, for both click-outside handlers. A Shift-press
 *  on this editor's text is left to that block, which grows a range from the image and ends it. */
export function pressLeavesImage(press: PointerEvent, editorRoot: Element | null): boolean {
	const target = press.target instanceof Element ? press.target : null;
	if (target?.closest(IMAGE_CHROME_SELECTOR)) return false;
	const ownedByBlock =
		press.shiftKey && !!editorRoot?.contains(target) && findSurfacePathForElement(target) !== null;
	return !ownedByBlock;
}

export interface WidgetTarget {
	// A deliberate snapshot, unlike the click path's live resolve (widget-dom.ts): a popover commit
	// must target the image it opened on, and writes nothing once another image holds these bytes.
	paragraphPath: number[];
	sourceStart: number;
	// The caret's raw offset just before widget selection took over; drives the undo
	// anchor so Ctrl+Z restores where the user was, not the deleted region's boundary.
	preSelectOffset: number;
}

export interface WidgetSelectionState {
	getSelected(): WidgetTarget | null;
	select(target: WidgetTarget): void;
	clear(): void;
	isSelected(paragraphPath: number[], sourceStart: number): boolean;
}

export interface CreateWidgetSelectionOpts {
	onSelect: () => void;
}

export function createWidgetSelectionState(opts: CreateWidgetSelectionOpts): WidgetSelectionState {
	let selected = $state<WidgetTarget | null>(null);

	return {
		getSelected: () => selected,
		select: (target) => {
			selected = {
				paragraphPath: [...target.paragraphPath],
				sourceStart: target.sourceStart,
				preSelectOffset: target.preSelectOffset
			};
			opts.onSelect();
		},
		clear: () => {
			selected = null;
		},
		isSelected: (path, start) =>
			selected !== null &&
			selected.sourceStart === start &&
			pathsEqual(selected.paragraphPath, path)
	};
}
