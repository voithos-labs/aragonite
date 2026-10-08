// A document with no final line break keeps none through any structural edit, unless the edit
// leaves a blank last line, which is nothing but its break; either way the reload reads the tree.
// Miss-analysis: the G2.13 corpus always ended in a line break, its gestures drove the tree
// operations directly, and the first cut of this property drew only top-level gestures and read
// only bytes, so an Enter inside a last quote that the reload read differently went unseen.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { CstNode, Document } from '#lib/core/nodes.js';
import { displayLength, documentLineEnding } from '#lib/core/lines.js';
import { holdsBlankLastLine } from '#lib/tree-operations/open-tail.js';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { createFocusActions } from '#lib/editor-actions/focus/focus.js';
import { ensureEditableContainers } from '#lib/tree-operations/node-primitives.js';
import {
	makeContainerHarness,
	makeListContextAt,
	makeTopHarness
} from '#lib/test/harness/editor-actions.js';
import {
	arbBlankSeparatedGfmDoc,
	freshOrFixedSeed
} from '#lib/test/invariants/arbitraries/index.js';

const PARAMS = { numRuns: 200, seed: freshOrFixedSeed(635616) } as const;

const arbOpenDoc = arbBlankSeparatedGfmDoc
	.map((source) => source.replace(/(?:\r?\n)+$/, ''))
	.filter((source) => source !== '');

type GestureOp =
	| 'split'
	| 'delete'
	| 'insert'
	| 'insertBlank'
	| 'mergePrev'
	| 'append'
	| 'quoteEnter'
	| 'itemEnter';
const arbGesture = fc.record({
	op: fc.constantFrom<GestureOp>(
		'split',
		'delete',
		'insert',
		'insertBlank',
		'mergePrev',
		'append',
		'quoteEnter',
		'itemEnter'
	),
	at: fc.nat({ max: 6 }),
	offset: fc.nat({ max: 40 })
});

type Shape = [kind: string, children: Shape | null][];
const shapeOf = (nodes: readonly CstNode[]): Shape =>
	nodes.map((node) => [node.kind, node.children ? shapeOf(node.children) : null]);

/** The blocks a reload of `doc`'s bytes holds once loaded, an empty container's paragraph included. */
function reloadedShape(doc: Document): Shape {
	const reload = parse(serialize(doc));
	for (const node of reload.children) ensureEditableContainers(node, documentLineEnding(reload));
	return shapeOf(reload.children);
}

/** A container gesture's document: the drawn one with a last quote or list to press Enter in. */
const withLast = (source: string, tail: string) =>
	source + (documentLineEnding(parse(source)) === '\r\n' ? '\r\n\r\n' : '\n\n') + tail;

async function edited(source: string, op: GestureOp, at: number, offset: number) {
	if (op === 'quoteEnter') {
		const full = withLast(source, '> tail');
		const last = parse(full).children.length - 1;
		const h = makeContainerHarness(full, [last]);
		await h.bundle.blockEdit.splitBlock(0, 'tail'.length);
		return h.deps.doc;
	}
	if (op === 'itemEnter') {
		const full = withLast(source, '- tail');
		const h = makeTopHarness(full);
		const last = h.deps.doc.children.length - 1;
		const { listContext } = makeListContextAt(h.deps, last, { controller: h.controller });
		await listContext.insertItemAfter(0);
		return h.deps.doc;
	}
	const h = makeTopHarness(source);
	const count = h.deps.doc.children.length;
	const i = at % count;
	const raw = h.deps.doc.children[i].raw;
	if (op === 'split') await h.actions.splitBlock(i, Math.min(offset, displayLength(raw)));
	if (op === 'delete') await h.actions.deleteBlock(i, 'keyless');
	if (op === 'insert') await h.actions.insertParagraph(at % (count + 1), 'x');
	if (op === 'insertBlank') await h.actions.insertParagraph(at % (count + 1), '');
	if (op === 'mergePrev' && i > 0) await h.actions.mergeWithPrevious(i);
	if (op === 'append') await createFocusActions(h.deps, h.controller).moveFocus(count, 'start');
	return h.deps.doc;
}

describe('an open last line through a random structural edit', () => {
	it('stays open, or ends in a blank line, and reloads as the tree', async () => {
		await fc.assert(
			fc.asyncProperty(arbOpenDoc, arbGesture, async (source, { op, at, offset }) => {
				const doc = await edited(source, op, at, offset);
				const bytes = serialize(doc);
				const label = JSON.stringify([source, op, bytes]);
				const last = doc.children.at(-1);
				if (last && bytes.endsWith('\n')) expect(holdsBlankLastLine(last), label).toBe(true);
				// Only the edits that land on the last line: the drawn corpus has joins of its own
				// that a reload reads differently, which G2.13 owns.
				if (op === 'quoteEnter' || op === 'itemEnter' || op === 'append') {
					expect(reloadedShape(doc), label).toEqual(shapeOf(doc.children));
				}
			}),
			PARAMS
		);
	});
});
