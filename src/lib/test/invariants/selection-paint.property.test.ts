// G1.187: a range across blocks paints one box over each block whose bytes lie inside the bytes a
// copy of it takes, its parent's not, and over no other block; a table's rows paint through its
// cells. Each direction is its own row, so a failure says which half broke.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parse } from '../../core/parser';
import { ownTrailingLineEnding } from '../../core/lines';
import type { Document } from '../../core/nodes';
import type { DocumentView } from '../../core/node-views';
import { countsCells } from '../../schema/block-kind-descriptor';
import { documentLayout, type Layout } from '../../range-edit/layout';
import type { Range } from '../../range-edit/edit-range';
import { blockNodeAt } from '../../tree-operations/node-primitives';
import { blockPaintsWholeBox, classifyBlockForSelection } from '../../selection/primitives';
import { rangeBytes, rangePaint, type RangePaint } from '../../selection/range-bytes';
import { coverRange, rangeCoverage } from '../../selection/range-coverage';
import { createSelectionState } from '../../selection/selection-state.svelte';
import { pathsEqual } from '../../selection/path-math';
import type { SelectionPoint } from '../../selection/primitives';
import { allBlockPaths, arbDocWithSelection, freshOrFixedSeed } from './arbitraries';

const PARAMS = { numRuns: 1000, seed: freshOrFixedSeed(424243) } as const;

interface Painted {
	doc: Document;
	paint: RangePaint;
	/** Whether the block's own bytes, up to its last line's text, lie inside the copy's. */
	inside(path: readonly number[]): boolean;
}

function painted(doc: Document, anchor: SelectionPoint, focus: SelectionPoint): Painted | null {
	const coverage = rangeCoverage(doc, coverRange(doc, anchor, focus));
	const { start, end } = coverage.range;
	if (pathsEqual(start.path, end.path) || coverage.grid) return null;
	const layout = documentLayout(doc);
	const bytes = rangeBytes(doc, coverage, layout);
	if (!bytes) throw new Error(`no bytes for [${start.path}]@${start.offset} → [${end.path}]`);
	return { doc, paint: rangePaint(doc, coverage, layout), inside: insideOf(doc, layout, bytes) };
}

function insideOf(doc: DocumentView, layout: Layout, bytes: Range) {
	return (path: readonly number[]): boolean => {
		const block = path.length > 0 ? layout.block(path) : undefined;
		if (!block) return false;
		const own = block.to - ownTrailingLineEnding(blockNodeAt(doc, path)!.raw).length;
		return bytes.from <= block.from && own <= bytes.to;
	};
}

/** The stored pair, as every gesture stores one: a table endpoint counts cells. */
function arbPainted(): fc.Arbitrary<Painted | null> {
	return arbDocWithSelection.map(({ doc, selection }) => {
		const state = createSelectionState({ getDoc: () => doc });
		state.enterCrossBlock(selection.anchor, selection.focus);
		const { anchor, focus } = state;
		return anchor && focus ? painted(doc, anchor, focus) : null;
	});
}

const underTable = (doc: DocumentView, path: readonly number[]) =>
	path.some((_, depth) => depth > 0 && countsCells(blockNodeAt(doc, path.slice(0, depth))!));

const boxed = (at: Painted, path: number[]) => blockPaintsWholeBox(path, at.paint, null);

describe('G1.187 the overlay paints the bytes a copy takes', () => {
	it('every block painted as one box lies inside the copy’s bytes, and its parent doesn’t', () => {
		fc.assert(
			fc.property(arbPainted(), (at) => {
				if (!at) return;
				for (const path of allBlockPaths(at.doc)) {
					if (!boxed(at, path)) continue;
					if (!at.inside(path)) throw new Error(`[${path}] paints a box outside the bytes`);
					if (at.inside(path.slice(0, -1))) throw new Error(`[${path}] paints under its parent`);
					if (underTable(at.doc, path)) throw new Error(`[${path}] paints a table's row as a box`);
					for (let depth = 1; depth < path.length; depth++) {
						if (boxed(at, path.slice(0, depth))) throw new Error(`[${path}] paints under a box`);
					}
				}
			}),
			PARAMS
		);
	});

	it('every block inside the copy’s bytes, its parent not, paints as one box', () => {
		fc.assert(
			fc.property(arbPainted(), (at) => {
				if (!at) return;
				for (const path of allBlockPaths(at.doc)) {
					if (!at.inside(path) || at.inside(path.slice(0, -1)) || underTable(at.doc, path))
						continue;
					if (!boxed(at, path))
						throw new Error(`[${path}] lies inside the bytes but paints no box`);
				}
			}),
			PARAMS
		);
	});

	// Shapes the draw rarely makes: a block with no text where the range ends, and a fence's body
	// ending where the range does, whose closing line lies outside it.
	it.each([
		['an empty item at the end, closing the list', 'ab\n\n- x\n- \n\nc\n', [1, 1, 0], [1], 'whole'],
		['a fenced body ending at the end', 'ab\n\n```\nbody\n```\n', [1], [1], 'end']
	])('%s', (_, source, endPath, block, expected) => {
		const doc = parse(source);
		const endOffset = endPath.length === 1 ? 8 : 0;
		const at = painted(doc, { path: [0], offset: 1 }, { path: endPath, offset: endOffset })!;
		expect(classifyBlockForSelection([0], at.paint)).toBe('start');
		expect(classifyBlockForSelection(block, at.paint)).toBe(expected);
		for (const path of allBlockPaths(doc)) {
			const outermost = at.inside(path) && !at.inside(path.slice(0, -1));
			expect(boxed(at, path), `[${path}]`).toBe(outermost);
		}
	});
});
