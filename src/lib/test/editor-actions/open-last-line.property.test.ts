// A document with no final line break keeps none through any structural edit, unless the edit
// leaves a blank last line, which is nothing but its break (GH #616).
// Miss-analysis: the G2.13 corpus always ended in a line break, and its gestures drove the tree
// operations directly, never the commit that now owns the rule.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { displayLength, endsInBlankLine } from '$lib/core/lines';
import { serialize } from '$lib/core/serializer';
import { createFocusActions } from '$lib/editor-actions/focus/focus';
import { makeTopHarness } from '$lib/test/harness/editor-actions';
import { arbBlankSeparatedGfmDoc, freshOrFixedSeed } from '$lib/test/invariants/arbitraries';

const PARAMS = { numRuns: 200, seed: freshOrFixedSeed(635616) } as const;

const arbOpenDoc = arbBlankSeparatedGfmDoc
	.map((source) => source.replace(/(?:\r?\n)+$/, ''))
	.filter((source) => source !== '');

type GestureOp = 'split' | 'delete' | 'insert' | 'insertBlank' | 'mergePrev' | 'append';
const arbGesture = fc.record({
	op: fc.constantFrom<GestureOp>('split', 'delete', 'insert', 'insertBlank', 'mergePrev', 'append'),
	at: fc.nat({ max: 6 }),
	offset: fc.nat({ max: 40 })
});

describe('an open last line through a random structural edit', () => {
	it('stays open, or ends in a blank line', async () => {
		await fc.assert(
			fc.asyncProperty(arbOpenDoc, arbGesture, async (source, { op, at, offset }) => {
				const h = makeTopHarness(source);
				const count = h.deps.doc.children.length;
				const i = at % count;
				const raw = h.deps.doc.children[i].raw;
				if (op === 'split') await h.actions.splitBlock(i, Math.min(offset, displayLength(raw)));
				if (op === 'delete') await h.actions.deleteBlock(i);
				if (op === 'insert') await h.actions.insertParagraph(at % (count + 1), 'x');
				if (op === 'insertBlank') await h.actions.insertParagraph(at % (count + 1), '');
				if (op === 'mergePrev' && i > 0) await h.actions.mergeWithPrevious(i);
				if (op === 'append')
					await createFocusActions(h.deps, h.controller).moveFocus(count, 'start');
				const bytes = serialize(h.deps.doc);
				if (bytes === '' || !bytes.endsWith('\n')) return;
				expect(endsInBlankLine(bytes), JSON.stringify([source, op, bytes])).toBe(true);
			}),
			PARAMS
		);
	});
});
