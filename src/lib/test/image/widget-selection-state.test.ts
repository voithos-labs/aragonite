// @vitest-environment jsdom
// The image readers' view over the selection state's widget. The widget's own rules are the
// selection state's (`test/selection/selection-state-widget.test.ts`).
import { describe, it, expect } from 'vitest';
import { createWidgetSelectionState } from '../../components/image/widget-selection-state.svelte';
import { createSelectionState } from '../../selection/selection-state.svelte';

describe('WidgetSelectionState', () => {
	it('reads and writes the selection state, holding nothing of its own', () => {
		const selection = createSelectionState();
		const view = createWidgetSelectionState(selection);

		view.select({ paragraphPath: [0], sourceStart: 5, preSelectOffset: 5 });
		expect(selection.widget).toEqual({ paragraphPath: [0], sourceStart: 5, preSelectOffset: 5 });

		selection.clear();
		expect(view.getSelected()).toBeNull();
	});

	it('isSelected matches the path and start exactly', () => {
		const view = createWidgetSelectionState(createSelectionState());
		expect(view.isSelected([0], 0)).toBe(false);

		view.select({ paragraphPath: [0, 1], sourceStart: 12, preSelectOffset: 12 });
		expect(view.isSelected([0, 1], 12)).toBe(true);
		expect(view.isSelected([0, 1], 13)).toBe(false);
		expect(view.isSelected([0, 2], 12)).toBe(false);
		expect(view.isSelected([0], 12)).toBe(false);
		expect(view.isSelected([0, 1, 0], 12)).toBe(false);
	});

	// The image's own clears run on every press and edit, so with no widget selected they must not
	// end a range the user is making.
	it('clear leaves a live range alone when no widget is selected', () => {
		const selection = createSelectionState();
		selection.enterCrossBlock({ path: [0], offset: 1 }, { path: [2], offset: 2 });

		createWidgetSelectionState(selection).clear();

		expect(selection.isCrossBlock).toBe(true);
	});
});
