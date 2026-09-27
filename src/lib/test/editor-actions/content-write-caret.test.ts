// The caret a writer computed moves with whatever the kind's rule and the container's rule
// inserted or dropped, once, inside the content write that stores the bytes.
// Miss-analysis: each kind mapped its caret beside its own component, so no test asked the write.
import { describe, it, expect } from 'vitest';
import { mountBodyRow, makeTopHarness } from '$lib/test/harness/editor-actions';

const TABLE = '| a | b |\n| - | - |\n| x | y |\n';

describe('a table cell write', () => {
	it('stores a typed pipe escaped and puts the caret after it', async () => {
		const row = mountBodyRow(TABLE);
		const write = row.blockEdit.updateBlockContent(0, 'x|', 'authored', 1, 2);
		await write;

		expect(row.deps.doc.children[0].children![1].children![0].raw).toBe('x\\|');
		expect(write.caret).toBe(3);
	});
});

describe('a fenced code write', () => {
	it('puts back a closer a truncating write dropped, the caret where the writer left it', async () => {
		const h = makeTopHarness('```js\nbody\n```\n');
		const write = h.actions.updateBlockContent(0, '```js\nbo\n', 'literal', 8, 8);
		await write;

		expect(h.deps.doc.children[0].raw).toBe('```js\nbo\n```\n');
		expect(write.caret).toBe(8);
	});

	it('moves the caret by the bytes a grown opener run gained', async () => {
		const h = makeTopHarness('```js\nbody\n```\n');
		// A body line reading as the closer: both runs grow by one, the opener ahead of the caret.
		const write = h.actions.updateBlockContent(0, '```js\n```\n```\n', 'literal', 9, 9);
		await write;

		expect(h.deps.doc.children[0].raw).toBe('````js\n```\n````\n');
		expect(write.caret).toBe(10);
	});

	// Read as content, the first closer typed into an open fence would grow its opener instead.
	it('stores a closer typed into an open fence one backtick at a time as typed', async () => {
		const h = makeTopHarness('```js\ncode\n');
		for (const typed of ['```js\ncode\n`', '```js\ncode\n``', '```js\ncode\n```']) {
			const write = h.actions.updateBlockContent(0, `${typed}\n`, 'authored', typed.length);
			await write;
			expect(h.deps.doc.children[0].raw).toBe(`${typed}\n`);
			expect(write.caret).toBe(typed.length);
		}
	});
});
