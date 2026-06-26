// Image-widget selection is mutually exclusive with caret and cross-block
// selection; `select` fires `onSelect` so the editor shell can clear the others.

export interface WidgetTarget {
	// Frozen at selection time on purpose — a popover commit (URL/alt/title) must
	// target the image the popover opened on, not the live selection (see
	// image-edit-commit's commitImageEdit). Unlike the click path (widget-dom.ts),
	// which resolves the path live, this is a deliberate snapshot. Safe to hold
	// because widget selection is cleared on every structural edit and navigation
	// (the .clear() calls in ImageOverlayHost / widget-interaction), so it can
	// never outlive a structural shift of its own path.
	paragraphPath: number[];
	sourceStart: number;
	// Raw offset the caret occupied just before widget selection took over.
	// Drives the undo anchor when a key (Backspace/Delete/typing) replaces
	// the selected widget — Ctrl+Z restores the caret to where the user
	// actually was, not to the far boundary of the deleted region.
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
		isSelected: (path, start) => {
			if (selected === null) return false;
			if (selected.sourceStart !== start) return false;
			if (selected.paragraphPath.length !== path.length) return false;
			for (let i = 0; i < path.length; i++) {
				if (selected.paragraphPath[i] !== path[i]) return false;
			}
			return true;
		}
	};
}
