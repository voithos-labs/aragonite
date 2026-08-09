// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createSelectionState } from '../../selection/selection-state.svelte';
import { selectWholeDocument } from '../../selection/keyboard-extend';
import { rangeDelete } from '../../selection/range-delete';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { createSharingState } from '../../tree-operations/sharing';
import { expectParseConverged } from '../harness/parse-converged';
import type { CstNode, Document } from '../../core/nodes';

const TABLE_FIRST = '| A | B |\n| --- | --- |\n| 1 | 2 |\n\npara\n';
const TABLE_LAST = 'para\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n';

function makeState(doc: Document) {
	return createSelectionState({ getDoc: () => doc });
}

/** Kinds nested where only rows/cells belong — non-empty means grid corruption. */
function gridForeigners(doc: Document): string[] {
	const bad: string[] = [];
	const walk = (node: CstNode) => {
		if (node.kind === 'table') {
			for (const row of node.children ?? []) {
				if (row.kind !== 'tableRow') bad.push(row.kind);
				for (const cell of row.children ?? []) {
					if (cell.kind !== 'tableCell') bad.push(cell.kind);
				}
			}
			return;
		}
		for (const child of node.children ?? []) walk(child);
	};
	for (const child of doc.children) walk(child);
	return bad;
}

// The deleted doc must not just re-serialize (a tautology) — its live tree must converge with a
// fresh parse of its bytes, catching a delete that leaves a stale grid or split-separator shape.
function assertDeleteConverged(doc: Document): void {
	expectParseConverged(doc);
	const out = serialize(doc);
	expect(serialize(parse(out))).toBe(out);
}

function deleteSelected(doc: Document, s: ReturnType<typeof makeState>) {
	return rangeDelete(doc, s.start!, s.end!, createSharingState(), undefined, undefined, undefined);
}

describe('table endpoints normalize at the selection-state choke point', () => {
	it('selectWholeDocument on a table-first doc snaps the start to a cell coordinate', () => {
		const doc = parse(TABLE_FIRST);
		const s = makeState(doc);
		expect(selectWholeDocument(s, doc)).toBe(true);
		expect(s.start).toEqual({ path: [0], offset: 0, cellCoordinate: true });
		const { newDoc } = deleteSelected(doc, s);
		expect(gridForeigners(newDoc)).toEqual([]);
		assertDeleteConverged(newDoc);
	});

	it('selectWholeDocument on a table-last doc snaps the end to a cell coordinate', () => {
		const doc = parse(TABLE_LAST);
		const s = makeState(doc);
		expect(selectWholeDocument(s, doc)).toBe(true);
		expect(s.end).toEqual({ path: [1], offset: 3, cellCoordinate: true });
		const { newDoc } = deleteSelected(doc, s);
		expect(gridForeigners(newDoc)).toEqual([]);
		assertDeleteConverged(newDoc);
	});

	it('enterCrossBlock normalizes a raw deep-cell anchor (shift-click shape, table first)', () => {
		const doc = parse(TABLE_FIRST);
		const s = makeState(doc);
		s.enterCrossBlock({ path: [0, 0, 0], offset: 0 }, { path: [1], offset: 2 });
		expect(s.anchor).toEqual({ path: [0], offset: 0, cellCoordinate: true });
		const { newDoc } = deleteSelected(doc, s);
		expect(gridForeigners(newDoc)).toEqual([]);
		assertDeleteConverged(newDoc);
	});

	it('enterCrossBlock normalizes a raw deep-cell focus (shift-click shape, table last)', () => {
		const doc = parse(TABLE_LAST);
		const s = makeState(doc);
		s.enterCrossBlock({ path: [0], offset: 1 }, { path: [1, 1, 0], offset: 1 });
		expect(s.focus).toEqual({ path: [1], offset: 2, cellCoordinate: true });
		const { newDoc } = deleteSelected(doc, s);
		expect(gridForeigners(newDoc)).toEqual([]);
		assertDeleteConverged(newDoc);
	});

	it('extendFocus normalizes a raw deep-cell point', () => {
		const doc = parse(TABLE_LAST);
		const s = makeState(doc);
		// Genuine cross-block seed (para → table): a same-path prose pair would
		// collapse in the seam and leave extendFocus without an anchor.
		s.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 2 });
		s.extendFocus({ path: [1, 0, 1], offset: 1 });
		expect(s.focus).toEqual({ path: [1], offset: 1, cellCoordinate: true });
	});

	it('passes an already-normalized cell-coordinate point through unchanged', () => {
		const doc = parse(TABLE_FIRST);
		const s = makeState(doc);
		s.enterCrossBlock({ path: [0], offset: 1, cellCoordinate: true }, { path: [1], offset: 0 });
		expect(s.anchor).toEqual({ path: [0], offset: 1, cellCoordinate: true });
	});

	it('leaves points untouched when no doc accessor is wired (harness fallback)', () => {
		const s = createSelectionState();
		s.enterCrossBlock({ path: [0, 0, 0], offset: 5 }, { path: [1], offset: 2 });
		expect(s.anchor).toEqual({ path: [0, 0, 0], offset: 5 });
	});
});
