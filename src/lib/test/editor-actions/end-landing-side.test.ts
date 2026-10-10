// An edit's landing inside a container sets the edge record the way one at the top level does: a
// merge lands on text, where the character before the caret decides, and a split starts fresh.
// Miss-analysis: the record was set only by the arrow key's own move, and no test read the caret
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
	it('a refused merge in a quote leaves no record at the previous block’s end', async () => {
		const caretMemory = createCaretMemory();
		const h = makeNestedHarness('> **a**\n>\n> ```\n> x\n> ```\n', {
			index: 0,
			presentationMode: 'live',
			caretMemory
		});
		mountEveryBlock(h.deps);
		caretMemory.noteOutside();

		await h.bundle.blockEdit.mergeWithPrevious(1);

		expect(caretMemory.side()).toBeNull();
		expect(h.landings).toEqual([
			{ leafPath: [0, 0], offset: expect.any(Number), outcome: 'placed' }
		]);
	});

	it('an empty item deleted in a list inside a quote leaves no record at the item above', async () => {
		const h = makeContainerHarness('> - **a**\n> - \n', [0, 0], {
			reading: fixtureReading({}, 'live')
		});
		const caretMemory = createCaretMemory();
		h.deps.caretMemory = caretMemory;
		mountEveryBlock(h.deps);
		caretMemory.noteOutside();

		await h.bundle.blockEdit.mergeWithPrevious(1);

		expect(caretMemory.side()).toBeNull();
		expect(h.landings).toEqual([
			{ leafPath: [0, 0, 0, 0], offset: expect.any(Number), outcome: 'placed' }
		]);
	});
});

describe('a split inside a container', () => {
	it('starts the second half fresh in a quote', async () => {
		const caretMemory = createCaretMemory();
		const h = makeNestedHarness('> **bold**\n', {
			index: 0,
			presentationMode: 'live',
			caretMemory
		});
		mountEveryBlock(h.deps);

		await h.bundle.blockEdit.splitBlock(0, 4);

		expect(caretMemory.side()).toBe('outside');
	});
});
