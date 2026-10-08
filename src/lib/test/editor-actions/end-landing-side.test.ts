// An edit that lands the caret at a block's end inside a container means the outside of a hidden
// closer, as a landing at the top level does, so the next byte typed does not join the construct.
// Miss-analysis: the side was set only by the arrow key's own move, and no test read the caret
// memory after an edit's landing inside a list or quote.
import { describe, expect, it } from 'vitest';
import { createCaretMemory } from '#lib/caret/caret-memory.js';
import {
	makeContainerHarness,
	makeNestedHarness,
	mountEveryBlock
} from '../harness/editor-actions';
import { fixtureReading } from '../harness/fixture-grammar';

describe('an end landing inside a container', () => {
	it('a refused merge in a quote lands outside the previous block’s closer', async () => {
		const caretMemory = createCaretMemory();
		const h = makeNestedHarness('> **a**\n>\n> ```\n> x\n> ```\n', {
			index: 0,
			presentationMode: 'live',
			caretMemory
		});
		mountEveryBlock(h.deps);

		await h.bundle.blockEdit.mergeWithPrevious(1);

		expect(caretMemory.side()).toBe('outside');
		expect(h.landings).toEqual([
			{ leafPath: [0, 0], offset: expect.any(Number), outcome: 'placed' }
		]);
	});

	it('an empty item deleted in a list inside a quote lands outside the item above’s closer', async () => {
		const h = makeContainerHarness('> - **a**\n> - \n', [0, 0], {
			reading: fixtureReading({}, 'live')
		});
		const caretMemory = createCaretMemory();
		h.deps.caretMemory = caretMemory;
		mountEveryBlock(h.deps);

		await h.bundle.blockEdit.mergeWithPrevious(1);

		expect(caretMemory.side()).toBe('outside');
		expect(h.landings).toEqual([
			{ leafPath: [0, 0, 0, 0], offset: expect.any(Number), outcome: 'placed' }
		]);
	});
});
