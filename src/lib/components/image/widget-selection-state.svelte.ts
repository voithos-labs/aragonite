// Image-widget selection is mutually exclusive with caret and cross-block
// selection; `select` fires `onSelect` so the editor shell can clear the others.

import { pathsEqual } from '../../selection/path-math';

/** What an outside-press dismiss handler must NOT treat as outside: the widget itself and
 *  the overlay chrome anchored to it. One string, because both handlers must move together. */
export const IMAGE_CHROME_SELECTOR = '[data-image-widget], [data-image-overlay]';

export interface WidgetTarget {
	// A deliberate snapshot, unlike the click path's live resolve (widget-dom.ts): a popover commit
	// must target the image it opened on. Safe to hold because widget selection clears on every
	// structural edit and navigation, so it cannot outlive a shift of its own path.
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
