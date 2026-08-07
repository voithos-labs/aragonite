// @vitest-environment jsdom
//
// Which root-scope moves park in a gap instead of entering the target block.
import { describe, it, expect, vi } from 'vitest';
import { parse } from '../../../core/parser';
import { createFocusActions } from '../../../editor-actions/focus/focus';
import { createUndoController } from '../../../editor-actions/commit/undo-controller';
import { makeEditorActionsDeps, mockRef } from '../../harness/editor-actions';
import type { FocusPosition } from '../../../block-component';
import type { MoveFocusOptions } from '../../../action-contracts';
import type { PresentationMode } from '../../../presentation-mode';

const TABLE = '| a | b |\n| - | - |\n';
const FENCE = '```\ncode\n```\n';
// paragraph, table, fencedCode, paragraph — the eligible boundary is 2.
const MIXED = `para\n\n${TABLE}\n${FENCE}\npara\n`;

function harnessFor(source: string, presentationMode?: PresentationMode) {
	const { deps, doc } = makeEditorActionsDeps(parse(source).children, { presentationMode });
	const focused: number[] = [];
	deps.setBlockRefs(doc.children.map((_, i) => mockRef({ focus: vi.fn(() => focused.push(i)) })));
	const focus = createFocusActions(deps, createUndoController(deps));
	return {
		doc,
		focused,
		selection: deps.selectionState,
		move: (index: number, position: FocusPosition, options?: MoveFocusOptions) =>
			focus.moveFocus(index, position, options)
	};
}

describe('moveFocus — directional gap stops', () => {
	it('stops at the boundary a downward move would cross', async () => {
		const h = harnessFor(MIXED);

		await h.move(2, 'start');

		expect(h.selection.gapCaret).toEqual({ parentPath: [], index: 2 });
		expect(h.focused).toEqual([]);
	});

	it('stops at the same boundary moving upward', async () => {
		const h = harnessFor(MIXED);

		await h.move(1, 'end');

		expect(h.selection.gapCaret).toEqual({ parentPath: [], index: 2 });
		expect(h.focused).toEqual([]);
	});

	it('enters the block at an ineligible boundary', async () => {
		const h = harnessFor(MIXED);

		await h.move(1, 'start');

		expect(h.selection.gapCaret).toBeNull();
		expect(h.focused).toEqual([1]);
	});

	// A numeric offset is a targeted landing with no direction — restore roads use it.
	it('never stops on a targeted landing', async () => {
		const h = harnessFor(MIXED);

		await h.move(2, 4);

		expect(h.selection.gapCaret).toBeNull();
		expect(h.focused).toEqual([2]);
	});

	it('never stops when the caller is leaving a gap', async () => {
		const h = harnessFor(MIXED);

		await h.move(2, 'start', { skipGapStop: true });

		expect(h.selection.gapCaret).toBeNull();
		expect(h.focused).toEqual([2]);
	});

	it('never stops in reading mode', async () => {
		const h = harnessFor(MIXED, 'reading');

		await h.move(2, 'start');

		expect(h.selection.gapCaret).toBeNull();
		expect(h.focused).toEqual([2]);
	});
});

describe('moveFocus — document edges', () => {
	it('stops before the first block when it declares the edge', async () => {
		const h = harnessFor(`${TABLE}\npara\n`);

		await h.move(-1, 'end');

		expect(h.selection.gapCaret).toEqual({ parentPath: [], index: 0 });
	});

	it('stays a no-op before an undeclared first block', async () => {
		const h = harnessFor(MIXED);

		await h.move(-1, 'end');

		expect(h.selection.gapCaret).toBeNull();
		expect(h.focused).toEqual([]);
	});

	// The move-past-end append owns the root's trailing boundary; a gap there would
	// swallow the trailing paragraph every Enter-at-the-end relies on.
	it('appends past the last block rather than stopping after it', async () => {
		const h = harnessFor(`para\n\n${FENCE}`);

		await h.move(2, 'start');

		expect(h.selection.gapCaret).toBeNull();
		expect(h.doc.children).toHaveLength(3);
		expect(h.doc.children[2].kind).toBe('paragraph');
	});
});
