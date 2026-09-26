// The caret a writer computed moves with whatever the kind's rule and the container's rule
// inserted or dropped, once, inside the content write that stores the bytes.
// Miss-analysis: each kind mapped its caret beside its own component (the cell's escaping
// wrapper, the code block's commit), so no test ever asked the one write for a caret at all.
import { describe, it, expect } from 'vitest';
import { mountBodyRow, makeTopHarness } from '$lib/test/harness/editor-actions';

const TABLE = '| a | b |\n| - | - |\n| x | y |\n';

// The write's stored caret, read off whatever the write returns.
const caretOf = (write: unknown): number | undefined => (write as { caret?: number }).caret;

describe('a table cell write', () => {
	it('stores a typed pipe escaped and puts the caret after it', async () => {
		const row = mountBodyRow(TABLE);
		const write = row.blockEdit.updateBlockContent(0, 'x|', 1, 2);
		await write;

		expect(row.deps.doc.children[0].children![1].children![0].raw).toBe('x\\|');
		expect(caretOf(write)).toBe(3);
	});
});

describe('a fenced code write', () => {
	it('puts back a closer a truncating write dropped, the caret where the writer left it', async () => {
		const h = makeTopHarness('```js\nbody\n```\n');
		const write = h.actions.updateBlockContent(0, '```js\nbo\n', 8, 8);
		await write;

		expect(h.deps.doc.children[0].raw).toBe('```js\nbo\n```\n');
		expect(caretOf(write)).toBe(8);
	});

	it('moves the caret by the bytes a grown opener run gained', async () => {
		const h = makeTopHarness('```js\nbody\n```\n');
		// A body line reading as the closer: both runs grow by one, the opener ahead of the caret.
		const write = h.actions.updateBlockContent(0, '```js\n```\n```\n', 9, 9);
		await write;

		expect(h.deps.doc.children[0].raw).toBe('````js\n```\n````\n');
		expect(caretOf(write)).toBe(10);
	});
});
