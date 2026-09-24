// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import {
	applyCollapsedCaret,
	applySingleBlockRange,
	readCurrentSelection,
	applySelectionToDom
} from '../../selection/native-bridge';
import { createSelectionState } from '../../selection/selection-state.svelte';
import { parse } from '../../core/parser';
import { mockRef } from '../harness/editor-actions';

describe('readCurrentSelection: unfocused editor', () => {
	it('returns null when no block reports a cursor (does not clamp to block 0 offset 0)', () => {
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

describe('undo selection snapshots: cellCoordinate round-trip', () => {
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

// Miss-analysis (GH #111): the clamp lived at one caller (the collapse path), so a restore
// arriving through any other caller (a range delete's descended-leaf caret at literal 0) put the
// native caret behind the hidden run, and no test observed `applyCollapsedCaret` itself.
describe('applyCollapsedCaret: the reachable clamp lives in the one writer', () => {
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

describe('applySelectionToDom: restore routing', () => {
	const TABLE_ONLY = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';

	it('single-block-range restore fires one onChange and never enters cross-block', () => {
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

	// A backward snapshot keeps its direction on restore; a range built from its two ends in
	// order would collapse to a caret at the focus.
	it('restores a backward single-block range with the anchor after the focus', () => {
		const doc = parse('paragraph one\n');
		const s = createSelectionState({ getDoc: () => doc });
		const block = document.createElement('div');
		block.setAttribute('contenteditable', 'true');
		const content = document.createTextNode('paragraph one');
		block.appendChild(content);
		document.body.appendChild(block);
		// Focused first: jsdom's focus() on an editing host resets the selection, which a browser
		// only does when the selection sits outside the host.
		block.focus();

		const placed = applySelectionToDom(
			{ anchor: { path: [0], offset: 9 }, focus: { path: [0], offset: 3 } },
			s,
			() => block
		);

		const sel = window.getSelection()!;
		expect(placed).toBe(true);
		expect(sel.anchorNode).toBe(content);
		expect(sel.anchorOffset).toBe(9);
		expect(sel.focusNode).toBe(content);
		expect(sel.focusOffset).toBe(3);
		document.body.replaceChildren();
	});

	// Miss-analysis: the backward case above has no marker span, and the marker branch ran before
	// the direction check, so no test asked for a backward range that starts at raw 0 behind one.
	it('keeps a backward range backward when it starts at raw 0 behind a marker span', () => {
		const block = document.createElement('div');
		block.setAttribute('contenteditable', 'true');
		const marker = document.createElement('span');
		marker.className = 'md-marker';
		marker.setAttribute('contenteditable', 'false');
		marker.textContent = '- ';
		const content = document.createTextNode('before pic after');
		block.append(marker, content);
		document.body.appendChild(block);
		block.focus();

		applySingleBlockRange(block, 10, 0);

		const sel = window.getSelection()!;
		expect(sel.anchorNode === content && sel.focusNode === content).toBe(true);
		expect({ anchor: sel.anchorOffset, focus: sel.focusOffset }).toEqual({ anchor: 10, focus: 0 });
		document.body.replaceChildren();
	});

	it('puts the caret the restore caret in the focus cell for an intra-table rect', () => {
		const doc = parse(TABLE_ONLY);
		const s = createSelectionState({ getDoc: () => doc });
		const requested: number[][] = [];

		applySelectionToDom(
			// A flagged anchor and an unflagged focus on the table path, cell index 3.
			{ anchor: { path: [0], offset: 0, cellCoordinate: true }, focus: { path: [0], offset: 3 } },
			s,
			(p) => {
				requested.push(p);
				return document.createElement('div');
			}
		);

		// Cell index 3 in a 2-column table is row 1, col 1: the caret goes in that cell, not at a
		// character offset on the table wrapper path [0].
		expect(requested).toEqual([[0, 1, 1]]);
	});

	// Miss-analysis: the restore path's table coverage all came in through the cross-block branch,
	// where a cell endpoint had to be translated to paint anything. The collapsed branch looks
	// like text from the outside, so nothing ever asked which space its offset was in.
	it('lands a collapsed cell selection in the cell, not at a char offset on the table', () => {
		const doc = parse(TABLE_ONLY);
		const s = createSelectionState({ getDoc: () => doc });
		const requested: number[][] = [];
		// What `getSelection()` reports for a caret in the last cell, and what a consumer replays
		// through `setSelection`.
		const stored = { path: [0], offset: 3, cellCoordinate: true as const };

		applySelectionToDom({ anchor: stored, focus: { ...stored } }, s, (p) => {
			requested.push(p);
			return document.createElement('div');
		});

		expect(requested).toEqual([[0, 1, 1]]);
		expect(s.isCrossBlock).toBe(false);
	});
});
