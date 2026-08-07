// @vitest-environment jsdom
//
// The arrival door: what a gap landing writes, and what it ends on the way in.
import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { tryGapStop } from '../../selection/gap-caret';
import { placeGapCaret } from '../../selection/caret-doors';
import { createSelectionState } from '../../selection/selection-state.svelte';
import type { PresentationMode } from '../../presentation-mode';

const TABLE = '| a | b |\n| - | - |\n';
const FENCE = '```\ncode\n```\n';
// paragraph, table, fencedCode, paragraph
const DOC = parse(`para\n\n${TABLE}\n${FENCE}\npara\n`);

const at = (block: number, offset: number) => ({ path: [block], offset });

function makeScope(mode: PresentationMode = 'source') {
	const selection = createSelectionState({ getDoc: () => DOC });
	return { selection, getDoc: () => DOC, getPresentationMode: () => mode };
}

describe('tryGapStop', () => {
	it('parks the caret at an eligible boundary and reports it stopped', () => {
		const scope = makeScope();

		expect(tryGapStop(scope, [], 2)).toBe(true);
		expect(scope.selection.gapCaret).toEqual({ parentPath: [], index: 2 });
	});

	it('leaves an ineligible boundary alone', () => {
		const scope = makeScope();

		expect(tryGapStop(scope, [], 1)).toBe(false);
		expect(scope.selection.gapCaret).toBeNull();
	});

	// Reading mode has no caret to park, so the move keeps its old landing.
	it('never stops in reading mode', () => {
		const scope = makeScope('reading');

		expect(tryGapStop(scope, [], 2)).toBe(false);
		expect(scope.selection.gapCaret).toBeNull();
	});

	it('stops on an unwired presentation mode', () => {
		const selection = createSelectionState({ getDoc: () => DOC });

		expect(tryGapStop({ selection, getDoc: () => DOC }, [], 2)).toBe(true);
	});
});

describe('placeGapCaret — the gap door', () => {
	it('ends a live cross-block range in the same gesture (G2.12)', () => {
		const selection = createSelectionState({ getDoc: () => DOC });
		selection.enterCrossBlock(at(0, 0), at(3, 2));

		placeGapCaret(selection, { parentPath: [], index: 2 });

		expect(selection.isCrossBlock).toBe(false);
		expect(selection.gapCaret).toEqual({ parentPath: [], index: 2 });
	});

	it('notifies once for the whole landing', () => {
		let emissions = 0;
		const selection = createSelectionState({ getDoc: () => DOC, onChange: () => emissions++ });
		selection.enterCrossBlock(at(0, 0), at(3, 2));
		emissions = 0;

		placeGapCaret(selection, { parentPath: [], index: 2 });

		expect(emissions).toBe(1);
	});
});
