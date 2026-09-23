import { describe, expect, it, vi } from 'vitest';
import type { SlashCommandEntry } from '$lib/plugins/slash-commands';
import { slashHarness } from './slash-harness';

describe('the slash list', () => {
	it('opens at a line start or after a space, never mid-word', async () => {
		const h = slashHarness('and');
		await h.type('/');
		expect(h.menu.getOpen()).toBeNull();
		await h.type(' /');
		expect(h.rows()).toContain('Quote');
	});

	it('lists the catalogue, then the headings, then host rows, and hides excluded ids', async () => {
		const host: SlashCommandEntry = { id: 'stamp', label: 'Stamp', insert: 'ok' };
		const h = slashHarness('', { entries: [host], exclude: ['divider', 'h3'] });
		await h.type('/');
		expect(h.rows()).toEqual([
			'Bulleted list',
			'To-do list',
			'Quote',
			'Code block',
			'Table',
			'Heading 1',
			'Heading 2',
			'Stamp'
		]);
	});

	it("a host row with a built-in id takes that row's place, and the pick is the host's", async () => {
		const pullQuote: SlashCommandEntry = { id: 'quote', label: 'Pull quote', insert: '> Pull: ' };
		const h = slashHarness('', { entries: [pullQuote] });
		await h.type('/');
		expect(h.rows()).toContain('Pull quote');
		expect(h.rows()).not.toContain('Quote');
		await h.type('pull');
		await h.pick();
		expect(h.inserted).toEqual([{ markdown: '> Pull: ', placement: 'caret' }]);
	});

	it('shows the parsed argument on the one row a space kept', async () => {
		const h = slashHarness('');
		await h.type('/table 3x4');
		expect(h.rows()).toEqual(['Table']);
		expect(h.details()).toEqual(['3×4']);
	});
});

describe('a pick', () => {
	it('/h2 on a text line removes its bytes, then runs the heading command with 2', async () => {
		const h = slashHarness('Title ');
		await h.type('/h2');
		expect(await h.pick()).toBe(true);
		expect(h.raw()).toBe('Title ');
		expect(h.ran).toEqual([{ id: 'heading.cycle', arg: 2 }]);
	});

	it('/quote on an empty line inserts at the caret', async () => {
		const h = slashHarness('');
		await h.type('/quote');
		await h.pick();
		expect(h.inserted).toEqual([{ markdown: '> ', placement: 'caret' }]);
	});

	it('/quote after text inserts below, keeping the text', async () => {
		const h = slashHarness('Some words ');
		await h.type('/quote');
		await h.pick();
		expect(h.raw()).toBe('Some words ');
		expect(h.inserted).toEqual([{ markdown: '> ', placement: 'below' }]);
	});

	it('/code js inserts a fence carrying the language', async () => {
		const h = slashHarness('');
		await h.type('/code js');
		await h.pick();
		expect(h.inserted).toEqual([{ markdown: '```js\n\n```\n', placement: 'caret' }]);
	});

	it('a host run entry receives the argument, and an insert entry its Markdown', async () => {
		const run = vi.fn();
		const entries: SlashCommandEntry[] = [
			{ id: 'cite', label: 'Cite', run, takesArgument: true },
			{ id: 'stamp', label: 'Stamp', insert: '**ok**' }
		];
		const h = slashHarness('', { entries });
		await h.type('/cite knuth');
		await h.pick();
		expect(run).toHaveBeenCalledWith(h.editor, 'knuth');
		await h.type('/stamp');
		await h.pick();
		expect(h.inserted).toEqual([{ markdown: '**ok**', placement: 'caret' }]);
	});
});

describe('leaving the list', () => {
	it('Escape keeps the typed bytes, and typing on does not reopen it', async () => {
		const h = slashHarness('');
		await h.type('/something');
		h.menu.close();
		await h.type(' more');
		expect(h.raw()).toBe('/something more');
		expect(h.caret()).toBe('/something more'.length);
		expect(h.menu.getOpen()).toBeNull();
	});

	it('an empty list holds no key, so Enter is the document’s', async () => {
		const h = slashHarness('');
		await h.type('/zzz');
		expect(h.menu.registry.isOpen).toBe(false);
		expect(await h.pick()).toBe(false);
		expect(h.inserted).toEqual([]);
	});

	it('a space ends the list unless the words before it name one argument taker', async () => {
		const h = slashHarness('');
		await h.type('/quote ');
		expect(h.menu.getOpen()).toBeNull();
	});
});

// Both, or neither, is a row that cannot say what a pick does; `npm run check` refuses it.
// @ts-expect-error insert and run together
export const both: SlashCommandEntry = { id: 'x', label: 'X', insert: 'a', run: () => {} };
// @ts-expect-error neither insert nor run
export const neither: SlashCommandEntry = { id: 'y', label: 'Y' };
