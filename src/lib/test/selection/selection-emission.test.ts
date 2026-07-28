// @vitest-environment jsdom
//
// When the selection channel notifies, and what the editor looks like at that
// moment. Subscribers read the editor back on notify (`getSelection()`), so an
// emission that escapes mid-restore reports a caret the restore is about to move.
import { describe, it, expect } from 'vitest';
import { createSelectionState } from '../../selection/selection-state.svelte';
import { applyCollapsedCaret, applySelectionToDom } from '../../selection/native-bridge';
import type { EditorSelection } from '../../selection/primitives';

interface Emission {
	/** The block the NATIVE caret sat in — what a subscriber's read-back resolves. */
	caretBlock: number | null;
	isCrossBlock: boolean;
}

function emissionHarness() {
	document.body.replaceChildren();
	const blocks = ['Alpha one', 'Bravo two'].map((text) => {
		const el = document.createElement('div');
		el.setAttribute('contenteditable', 'true');
		el.tabIndex = 0;
		el.textContent = text;
		document.body.append(el);
		return el;
	});

	const emissions: Emission[] = [];
	const caretBlock = (): number | null => {
		const node = window.getSelection()?.anchorNode ?? null;
		if (!node) return null;
		const index = blocks.findIndex((el) => el.contains(node));
		return index < 0 ? null : index;
	};
	const selectionState = createSelectionState({
		onChange: () =>
			emissions.push({ caretBlock: caretBlock(), isCrossBlock: selectionState.isCrossBlock })
	});

	return {
		emissions,
		selectionState,
		parkCaretIn(index: number, offset: number): void {
			applyCollapsedCaret(blocks[index], { path: [index], offset });
			emissions.length = 0;
		},
		restore(selection: EditorSelection): boolean {
			return applySelectionToDom(selection, selectionState, (path) => blocks[path[0]] ?? null);
		}
	};
}

const at = (block: number, offset: number) => ({ path: [block], offset });

describe('the restore road settles before it notifies', () => {
	it('a collapsed restore reports the landed caret, not the outgoing one', () => {
		const h = emissionHarness();
		h.parkCaretIn(0, 3);

		h.restore({ anchor: at(1, 2), focus: at(1, 2) });

		expect(h.emissions).toEqual([{ caretBlock: 1, isCrossBlock: false }]);
	});

	it('a single-block range restore reports the restored block', () => {
		const h = emissionHarness();
		h.parkCaretIn(0, 3);

		h.restore({ anchor: at(1, 0), focus: at(1, 4) });

		expect(h.emissions).toEqual([{ caretBlock: 1, isCrossBlock: false }]);
	});

	it('a cross-block restore notifies once, with the park caret already landed', () => {
		const h = emissionHarness();
		h.parkCaretIn(0, 3);

		h.restore({ anchor: at(0, 1), focus: at(1, 2) });

		expect(h.emissions).toEqual([{ caretBlock: 1, isCrossBlock: true }]);
	});
});

describe('SelectionState.batch', () => {
	function counting() {
		let notifies = 0;
		const state = createSelectionState({ onChange: () => notifies++ });
		return { state, count: () => notifies };
	}

	it('coalesces every mutation in the body into one notify', () => {
		const { state, count } = counting();

		state.batch(() => {
			state.enterCrossBlock(at(0, 0), at(1, 1));
			state.extendFocus(at(2, 2));
			state.incrementSelectAllCount();
		});

		expect(count()).toBe(1);
		expect(state.focus).toEqual({ path: [2], offset: 2 });
	});

	it('notifies nothing when the body mutates nothing', () => {
		const { state, count } = counting();

		state.batch(() => {});

		expect(count()).toBe(0);
	});

	it('notifies once at the outermost exit of nested batches', () => {
		const { state, count } = counting();

		state.batch(() => {
			state.collapse();
			state.batch(() => state.incrementSelectAllCount());
			expect(count()).toBe(0);
		});

		expect(count()).toBe(1);
	});

	// A depth that leaks on a throw mutes the selection channel for the editor's
	// whole lifetime — the failure worth guarding at the seam, not at call sites.
	it('flushes and stays usable when the body throws', () => {
		const { state, count } = counting();

		expect(() =>
			state.batch(() => {
				state.collapse();
				throw new Error('boom');
			})
		).toThrow('boom');
		expect(count()).toBe(1);

		state.collapse();
		expect(count()).toBe(2);
	});
});
