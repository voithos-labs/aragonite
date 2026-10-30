// G1.161: a typed insert left to the browser lands at its caret, or across hidden marker text.
import { describe, expect, it } from 'vitest';
import { checkTypedInsertAtCaret } from '#lib/invariants/typed-insert-at-caret.js';

/** Every character of `text` shown, but those at `hidden`. */
const shown = (text: string, hidden: number[] = []) =>
	[...text].map((_, i) => i).filter((i) => !hidden.includes(i));

describe('checkTypedInsertAtCaret', () => {
	it('passes a letter the browser put at the caret', () => {
		const after = 'abZc';
		expect(
			checkTypedInsertAtCaret({ before: 'abc', after, caret: 2, visible: shown(after), data: 'Z' })
		).toBeNull();
	});

	it('passes a letter typed into a run of its own kind, wherever in the run it read', () => {
		const after = 'heLLLo';
		expect(
			checkTypedInsertAtCaret({
				before: 'heLLo',
				after,
				caret: 4,
				visible: shown(after),
				data: 'L'
			})
		).toBeNull();
	});

	it('passes a letter the browser put across a hidden run from the caret', () => {
		// `**b**Z` read back as `**bZ**`: the closer between the two offsets paints nothing.
		const after = '**bZ**';
		expect(
			checkTypedInsertAtCaret({
				before: '**b**',
				after,
				caret: 5,
				visible: shown(after, [0, 1, 4, 5]),
				data: 'Z'
			})
		).toBeNull();
	});

	it('fires on a letter the browser put across shown text, naming what was typed', () => {
		const after = 'Zlead';
		expect(
			checkTypedInsertAtCaret({ before: 'lead', after, caret: 4, visible: shown(after), data: 'Z' })
		).toMatchObject({ code: 'typed-insert-at-caret', detail: { data: 'Z', caret: 4, landed: 0 } });
	});

	it('says nothing of an edit that is no single insertion', () => {
		const after = 'aXYc';
		expect(
			checkTypedInsertAtCaret({ before: 'abc', after, caret: 1, visible: shown(after), data: 'X' })
		).toBeNull();
	});
});
