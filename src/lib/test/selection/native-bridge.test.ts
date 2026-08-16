// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import {
	applyCollapsedCaret,
	readCurrentSelection,
	applySelectionToDom
} from '../../selection/native-bridge';
import { createSelectionState } from '../../selection/selection-state.svelte';
import { parse } from '../../core/parser';
import { mockRef } from '../harness/editor-actions';

describe('readCurrentSelection — unfocused editor', () => {
	it('returns null when no block reports a cursor (does NOT clamp to block 0 offset 0)', () => {
		const selectionState = createSelectionState();
		const blockRefs = [
			mockRef({ getCursorOffset: () => null }),
			mockRef({ getCursorOffset: () => null }),
			mockRef({ getCursorOffset: () => null })
		];

		const result = readCurrentSelection(selectionState, blockRefs);

		expect(result).toBeNull();
	});

	it('returns the focused block caret when exactly one block reports an offset', () => {
		const selectionState = createSelectionState();
		const blockRefs = [
			mockRef({ getCursorOffset: () => null }),
			mockRef({ getCursorOffset: () => 7 }),
			mockRef({ getCursorOffset: () => null })
		];
		const result = readCurrentSelection(selectionState, blockRefs);
		expect(result).toEqual({
			anchor: { path: [1], offset: 7 },
			focus: { path: [1], offset: 7 }
		});
	});
});

describe('undo selection snapshots — cellCoordinate round-trip', () => {
	const TABLE_LAST = 'para\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n';

	it('readCurrentSelection preserves the flag on cross-block table endpoints', () => {
		const doc = parse(TABLE_LAST);
		const s = createSelectionState({ getDoc: () => doc });
		s.enterCrossBlock({ path: [0], offset: 1 }, { path: [1], offset: 2, cellCoordinate: true });

		const snap = readCurrentSelection(s, []);

		expect(snap?.focus).toEqual({ path: [1], offset: 2, cellCoordinate: true });
		expect(snap?.anchor).toEqual({ path: [0], offset: 1 });
	});

	it('applySelectionToDom restores a table endpoint that still row-snaps', () => {
		const doc = parse(TABLE_LAST);
		const s = createSelectionState({ getDoc: () => doc });
		s.enterCrossBlock({ path: [0], offset: 1 }, { path: [1], offset: 2, cellCoordinate: true });
		const snap = readCurrentSelection(s, [])!;

		const restored = createSelectionState({ getDoc: () => doc });
		applySelectionToDom(snap, restored, () => null);

		expect(restored.focus?.cellCoordinate).toBe(true);
		// The whole-row snap keys on the flag: the end endpoint snaps to the
		// row's last cell. A dropped flag skips the snap and leaves offset 2.
		expect(restored.end?.offset).toBe(3);
	});
});

// Miss-analysis (GH #111): the clamp lived at ONE caller (the collapse road), so a restore
// arriving through any other caller — a range delete's descended-leaf caret at literal 0 —
// seated the native caret behind the hidden run and no test observed the door itself.
describe('applyCollapsedCaret — the landable clamp lives in the door', () => {
	afterEach(() => document.body.replaceChildren());

	function mountBlock(mode?: string): { block: HTMLElement; marker: HTMLElement; content: Text } {
		const root = document.createElement('div');
		if (mode) root.setAttribute('data-presentation', mode);
		const block = document.createElement('div');
		block.setAttribute('contenteditable', 'true');
		const marker = document.createElement('span');
		marker.className = 'md-marker';
		marker.textContent = '**';
		const content = document.createTextNode('bold tail');
		block.append(marker, content);
		root.appendChild(block);
		document.body.appendChild(root);
		return { block, marker, content };
	}

	it('a collapsed caret at raw 0 lands beside a hidden leading run, never behind it', () => {
		const { block, content } = mountBlock('live');
		applyCollapsedCaret(block, { path: [0], offset: 0 });

		const sel = window.getSelection()!;
		expect(sel.anchorNode).toBe(content);
		expect(sel.anchorOffset).toBe(0);
	});

	it('source mode is identity: the same offset stays on the painted marker', () => {
		const { marker } = mountBlock(undefined);
		applyCollapsedCaret(marker.parentElement as HTMLElement, { path: [0], offset: 0 });

		expect(window.getSelection()!.anchorNode).toBe(marker.firstChild);
		expect(window.getSelection()!.anchorOffset).toBe(0);
	});
});

describe('applySelectionToDom — restore routing', () => {
	const TABLE_ONLY = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';

	it('single-block-range restore fires one onChange and never enters cross-block (E-F8)', () => {
		const doc = parse('paragraph one\n');
		let onChangeCount = 0;
		let sawCrossBlock = false;
		const s = createSelectionState({
			getDoc: () => doc,
			onChange: () => {
				onChangeCount++;
				if (s.isCrossBlock) sawCrossBlock = true;
			}
		});

		applySelectionToDom(
			{ anchor: { path: [0], offset: 0 }, focus: { path: [0], offset: 5 } },
			s,
			() => null
		);

		expect(onChangeCount).toBe(1);
		expect(sawCrossBlock).toBe(false);
		expect(s.isCrossBlock).toBe(false);
	});

	it('parks the restore caret in the focus cell for an intra-table rect (E-F4)', () => {
		const doc = parse(TABLE_ONLY);
		const s = createSelectionState({ getDoc: () => doc });
		const requested: number[][] = [];

		applySelectionToDom(
			// Flagged anchor + context-established (unflagged) focus, cell index 3.
			{ anchor: { path: [0], offset: 0, cellCoordinate: true }, focus: { path: [0], offset: 3 } },
			s,
			(p) => {
				requested.push(p);
				return document.createElement('div');
			}
		);

		// Cell index 3 in a 2-column table is row 1, col 1 — park in the deep cell,
		// not a char-walk on the table wrapper path [0].
		expect(requested).toEqual([[0, 1, 1]]);
	});

	// Miss (Sel-F2): the restore road's table coverage all came in through the cross-block arm,
	// where a cell endpoint HAD to be translated to paint anything. The collapsed arm looks like
	// prose from the outside, so nothing ever asked which space its offset was in.
	it('lands a COLLAPSED cell selection in the cell, not at a char offset on the table', () => {
		const doc = parse(TABLE_ONLY);
		const s = createSelectionState({ getDoc: () => doc });
		const requested: number[][] = [];
		// What getSelection() reports for a caret parked in the last cell, and what a consumer
		// replays through setSelection.
		const stored = { path: [0], offset: 3, cellCoordinate: true as const };

		applySelectionToDom({ anchor: stored, focus: { ...stored } }, s, (p) => {
			requested.push(p);
			return document.createElement('div');
		});

		expect(requested).toEqual([[0, 1, 1]]);
		expect(s.isCrossBlock).toBe(false);
	});
});
