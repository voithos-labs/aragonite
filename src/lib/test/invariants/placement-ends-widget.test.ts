// @vitest-environment jsdom
// G1.46: a block's focus and the restore check, as they place, that no widget stayed selected.
import { describe, it, expect } from 'vitest';
import { checkPlacementEndsWidget } from '../../invariants/placement-ends-widget';
import { placeCaret, selectWidgetWhole } from '../../selection/place-caret';
import { applySelectionToDom } from '../../selection/native-bridge';
import { createSelectionState, type SelectionState } from '../../selection/selection-state.svelte';
import { restoreTarget } from '../harness/restore-landing';
import { takeDevWarns } from '../support/warn-gate';

const IMAGE = { paragraphPath: [0], sourceStart: 0, preSelectOffset: 0 };

/** A selection state whose clears forget the widget, the break the check exists to catch. */
function clearsSkipTheWidget(): SelectionState {
	const real = createSelectionState();
	selectWidgetWhole(real, IMAGE);
	return new Proxy(real, {
		get(target, prop) {
			if (prop === 'clear' || prop === 'collapse') return () => {};
			const value = Reflect.get(target, prop, target);
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
}

describe('G1.46 a placed caret or range leaves no widget selected', () => {
	it('passes with no widget and names the one left selected', () => {
		expect(checkPlacementEndsWidget(null)).toBeNull();
		expect(checkPlacementEndsWidget(IMAGE)?.code).toBe('placement-ends-widget');
	});

	it('fires from a block’s focus when the clear leaves the widget', () => {
		placeCaret(clearsSkipTheWidget(), () => {})(1);

		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:placement-ends-widget']);
	});

	it('fires from a restore when the clear leaves the widget', () => {
		const selection = clearsSkipTheWidget();
		const block = document.createElement('div');
		block.textContent = 'abc';

		applySelectionToDom(
			{ anchor: { path: [1], offset: 1 }, focus: { path: [1], offset: 1 } },
			restoreTarget(selection, () => block)
		);

		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:placement-ends-widget']);
	});

	it('stays silent when the store ends the widget as it should', () => {
		const selection = createSelectionState();
		selectWidgetWhole(selection, IMAGE);

		placeCaret(selection, () => {})(1);

		expect(selection.widget).toBeNull();
		expect(takeDevWarns()).toEqual([]);
	});
});
