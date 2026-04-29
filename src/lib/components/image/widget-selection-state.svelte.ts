// Image-widget selection is mutually exclusive with caret and cross-block
// selection; `select` fires `onSelect` so the editor shell can clear the others.

export interface WidgetTarget {
	paragraphPath: number[];
	sourceStart: number;
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

export function createWidgetSelectionState(
	opts: CreateWidgetSelectionOpts
): WidgetSelectionState {
	let selected = $state<WidgetTarget | null>(null);

	return {
		getSelected: () => selected,
		select: (target) => {
			selected = {
				paragraphPath: [...target.paragraphPath],
				sourceStart: target.sourceStart
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
