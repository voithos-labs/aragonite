// @vitest-environment jsdom
//
// The two caret doors a block component exposes. `parkCaret` is each surface's own primitive
// (exercised through the surfaces' own suites); this pins what `placeCaret` adds on top of it.
import { describe, it, expect } from 'vitest';
import { placeCaret } from '../../selection/caret-doors';
import { createSelectionState } from '../../selection/selection-state.svelte';

const at = (block: number, offset: number) => ({ path: [block], offset });

function liveRange() {
	const emissions: { isCrossBlock: boolean; landed: number | null }[] = [];
	let landed: number | null = null;
	const selection = createSelectionState({
		onChange: () => emissions.push({ isCrossBlock: selection.isCrossBlock, landed })
	});
	selection.enterCrossBlock(at(0, 0), at(2, 4));
	emissions.length = 0;
	return {
		selection,
		emissions,
		park: (offset: number) => {
			landed = offset;
		},
		get landed() {
			return landed;
		}
	};
}

describe('placeCaret — the safe caret door', () => {
	it('ends a live cross-block range and lands the caret', () => {
		const h = liveRange();

		placeCaret(h.selection, h.park)(7);

		expect(h.selection.isCrossBlock).toBe(false);
		expect(h.landed).toBe(7);
	});

	// The park primitive is untouched by the split: reaching for it directly with a
	// range live is what an extend does, and it must still leave the range alone.
	it('leaves the range live when the park primitive is called directly', () => {
		const h = liveRange();

		h.park(7);

		expect(h.selection.isCrossBlock).toBe(true);
		expect(h.landed).toBe(7);
	});

	// The T5 rule: subscribers read the editor back on notify, so an emission between the state write
	// and the DOM landing reports a caret the landing is about to move.
	it('notifies once, after the caret has landed', () => {
		const h = liveRange();

		placeCaret(h.selection, h.park)(7);

		expect(h.emissions).toEqual([{ isCrossBlock: false, landed: 7 }]);
	});

	// `clear()` notifies whether or not it changed anything, and most caret placements happen with no
	// range standing — the guard is what keeps the selection channel quiet.
	it('emits nothing when no range is live', () => {
		const emissions: number[] = [];
		const selection = createSelectionState({ onChange: () => emissions.push(1) });
		let landed: number | null = null;

		placeCaret(selection, (offset) => {
			landed = offset;
		})(3);

		expect(landed).toBe(3);
		expect(emissions).toEqual([]);
	});

	it('clears the native selection too, so a whole-block landing leaves nothing painted', () => {
		const el = document.createElement('div');
		el.textContent = 'alpha bravo';
		document.body.append(el);
		const range = document.createRange();
		range.selectNodeContents(el);
		window.getSelection()?.removeAllRanges();
		window.getSelection()?.addRange(range);
		expect(window.getSelection()?.rangeCount).toBe(1);

		const h = liveRange();
		// A whole-block landing seats no DOM range of its own — the ThematicBreak model.
		placeCaret(h.selection, () => {})(0);

		expect(window.getSelection()?.rangeCount).toBe(0);
		el.remove();
	});

	it('nests inside a caller-owned batch without emitting early', () => {
		const h = liveRange();

		h.selection.batch(() => {
			placeCaret(h.selection, h.park)(7);
			expect(h.emissions).toEqual([]);
		});

		expect(h.emissions).toEqual([{ isCrossBlock: false, landed: 7 }]);
	});
});
