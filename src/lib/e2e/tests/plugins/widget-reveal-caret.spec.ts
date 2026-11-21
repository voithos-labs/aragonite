import { test, expect } from '../../fixtures';
import type { PresentationMode } from '../../../presentation-mode';
import { PluginsPage, capturedErrors, clickWidgetEnd } from './helpers';
import { edgeKey } from '../../platform-keys';

/**
 * Typing a widget's opening byte in front of its body, for every widget kind that can show its
 * source: the caret stays one past the typed byte with the source shown, and a key that stops the
 * source reading as its widget writes at once (`#` then Space makes a heading while you watch).
 * Requirements: e2e/requirements/plugins/widget-reveal-caret.md.
 */

interface KindRow {
	kind: string;
	seed: string | undefined;
	doc: string;
	at: number;
	key: string;
	/** The source the typed byte completes, starting at `at`. */
	source: string;
}

// Every kind registered with `revealSource` and no content span; G4.211's scan holds this list
// to the registrations.
const KINDS: KindRow[] = [
	{
		kind: 'harness-tag',
		seed: 'tags',
		doc: 'few words here\n',
		at: 0,
		key: 'Shift+Digit3',
		source: '#few'
	},
	{
		kind: 'footnote-ref',
		seed: 'footnotes',
		doc: 'Ref ^a] here.\n\n[^a]: Body.\n',
		at: 4,
		key: 'BracketLeft',
		source: '[^a]'
	},
	{
		kind: 'harness-wikilinks/wikilink',
		seed: 'wikilinks',
		doc: 'See [Meeting notes]] today\n',
		at: 4,
		key: 'BracketLeft',
		source: '[[Meeting notes]]'
	},
	{
		kind: 'directiveText',
		seed: undefined,
		doc: 'see abbr[HTML] here\n',
		at: 4,
		key: 'Shift+Semicolon',
		source: ':abbr[HTML]'
	}
];

const MODES: PresentationMode[] = ['source', 'live'];

/** The caret as the editor reads it: the block path and the raw offset. */
async function caret(editor: PluginsPage) {
	await editor.waitForRenderFlush();
	return (await editor.bridge.getSelectionPaths())?.focus;
}

/** How many rendered widgets the top-level block at `index` holds; a shown source is not one. */
function widgetsIn(editor: PluginsPage, index: number): Promise<number> {
	return editor.page.evaluate(
		(i) => document.querySelectorAll(`[data-block-path='[${i}]'] [data-inline-widget]`).length,
		index
	);
}

/** How many shown sources carry the tint, read off the CSS highlight the block paints. */
function washedRanges(editor: PluginsPage): Promise<number> {
	return editor.page.evaluate(() => CSS.highlights.get('md-inline-reveal')?.size ?? 0);
}

async function open(
	editor: PluginsPage,
	seed: string | undefined,
	doc: string,
	mode: PresentationMode
) {
	await editor.gotoPlugins(seed);
	await editor.loadContent(doc);
	await editor.setPresentationMode(mode);
}

test.describe('a caret typed into a widget that can show its source', () => {
	for (const row of KINDS) {
		for (const mode of MODES) {
			test(`${row.kind} (${mode}): the opening byte keeps the caret one past it, source shown`, async ({
				page
			}) => {
				const editor = new PluginsPage(page);
				await open(editor, row.seed, row.doc, mode);
				await editor.focusBlock(0, row.at);
				await page.keyboard.press(row.key);

				expect(await caret(editor)).toEqual({ path: [0], offset: row.at + 1 });
				expect((await editor.bridge.getSource()).slice(row.at)).toMatch(
					new RegExp(`^${row.source.replace(/[[\]^]/g, '\\$&')}`)
				);
				// Read again after things settle: a source that closes itself shows only for a moment.
				await editor.waitForRenderFlush();
				expect(await widgetsIn(editor, 0)).toBe(0);
				await expect(page.locator("[data-block-path='[0]'] [contenteditable]")).toContainText(
					row.source
				);
				expect(await capturedErrors(page)).toEqual([]);
			});
		}
	}

	for (const mode of MODES) {
		for (const hashes of ['#', '##', '###']) {
			test(`tags (${mode}): ${hashes} then Space before words makes a heading at once`, async ({
				page
			}) => {
				const editor = new PluginsPage(page);
				await open(editor, 'tags', 'few words here\n\nOther\n', mode);
				await editor.focusBlock(0, 0);
				for (let i = 0; i < hashes.length; i++) await page.keyboard.press('Shift+Digit3');
				await page.keyboard.press('Space');

				// No End, no click: the heading forms on the Space, not when the source closes.
				expect(await editor.bridge.getBlockKind(0)).toBe('heading');
				expect(await editor.bridge.getSource()).toBe(`${hashes} few words here\n\nOther\n`);
				expect(await caret(editor)).toEqual({ path: [0], offset: hashes.length + 1 });
				// The block changed kind, so the source it showed closed with it.
				expect(await washedRanges(editor)).toBe(0);
				expect(await capturedErrors(page)).toEqual([]);
			});
		}
	}

	test('tags: a Space after a mid-line tag keeps the paragraph and the source open', async ({
		page
	}) => {
		const editor = new PluginsPage(page);
		await open(editor, 'tags', 'text few words\n\nOther\n', 'source');
		await editor.focusBlock(0, 5);
		await page.keyboard.press('Shift+Digit3');
		await page.keyboard.press('Space');

		expect(await editor.bridge.getSource()).toBe('text # few words\n\nOther\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');
		expect(await caret(editor)).toEqual({ path: [0], offset: 7 });
		// The source stays shown over `# few` until the caret leaves it.
		expect(await washedRanges(editor)).toBe(1);
		await page.keyboard.press(edgeKey('lineEnd'));
		await expect.poll(() => washedRanges(editor)).toBe(0);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('tags: undo and redo put the caret back inside a tag with its source shown', async ({
		page
	}) => {
		const editor = new PluginsPage(page);
		await open(editor, 'tags', '#few words here\n\nOther\n', 'source');
		await editor.focusBlock(0, 2);
		// One key: two can fall into two undo steps when a loaded runner spaces them past the pause.
		await page.keyboard.type('a');
		expect(await editor.bridge.getSource()).toBe('#faew words here\n\nOther\n');
		await page.keyboard.press(edgeKey('lineEnd'));

		await editor.undo();
		expect(await editor.bridge.getSource()).toBe('#few words here\n\nOther\n');
		expect(await caret(editor)).toEqual({ path: [0], offset: 2 });
		expect(await widgetsIn(editor, 0)).toBe(0);
		await editor.redo();
		expect(await editor.bridge.getSource()).toBe('#faew words here\n\nOther\n');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('math (live): a formula typed through a state that is not math keeps its source shown', async ({
		page
	}) => {
		const editor = new PluginsPage(page);
		await open(editor, 'math', 'Sum $x$ tail\n\nNext\n', 'live');
		await clickWidgetEnd(page.locator("[data-block-path='[0]'] [data-inline-widget]"));
		await expect.poll(() => widgetsIn(editor, 0)).toBe(0);

		// `$x $` is not math, so nothing would draw it as a formula: the source stays as it was.
		await page.keyboard.press('Space');
		expect(await editor.bridge.getSource()).toBe('Sum $x $ tail\n\nNext\n');
		expect(await widgetsIn(editor, 0)).toBe(0);
		expect(await washedRanges(editor)).toBe(1);
		await page.keyboard.type('y');
		expect(await editor.bridge.getSource()).toBe('Sum $x y$ tail\n\nNext\n');
		expect(await widgetsIn(editor, 0)).toBe(0);
		expect(await washedRanges(editor)).toBe(1);

		await page.keyboard.press(edgeKey('lineEnd'));
		await expect.poll(() => widgetsIn(editor, 0)).toBe(1);
		expect(await washedRanges(editor)).toBe(0);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('tags: Backspace that turns a heading back into a tag keeps the caret inside it', async ({
		page
	}) => {
		const editor = new PluginsPage(page);
		await open(editor, 'tags', '# few words here\n\nOther\n', 'source');
		await editor.focusBlock(0, 2);
		await page.keyboard.press('Backspace');

		expect(await editor.bridge.getSource()).toBe('#few words here\n\nOther\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');
		expect(await caret(editor)).toEqual({ path: [0], offset: 1 });
		await editor.waitForRenderFlush();
		expect(await widgetsIn(editor, 0)).toBe(0);

		// Undo with the source still shown puts the caret back where the Backspace began.
		await editor.undo();
		expect(await editor.bridge.getSource()).toBe('# few words here\n\nOther\n');
		expect(await caret(editor)).toEqual({ path: [0], offset: 2 });
		expect(await capturedErrors(page)).toEqual([]);
	});

	test("tags: the editor's setSelection inside a tag opens its source there", async ({ page }) => {
		const editor = new PluginsPage(page);
		await open(editor, 'tags', '#few words here\n\nOther\n', 'source');
		await editor.focusBlock(1, 0);
		await editor.focusBlock(0, 2);

		expect(await caret(editor)).toEqual({ path: [0], offset: 2 });
		await editor.waitForRenderFlush();
		expect(await widgetsIn(editor, 0)).toBe(0);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('tags: Backspace that joins `#` to the next block keeps the caret at the join', async ({
		page
	}) => {
		const editor = new PluginsPage(page);
		await open(editor, 'tags', 'tag #\n\nfew words\n', 'source');
		await editor.focusBlock(1, 0);
		await page.keyboard.press('Backspace');

		expect(await editor.bridge.getSource()).toBe('tag #few words\n');
		expect(await caret(editor)).toEqual({ path: [0], offset: 5 });
		expect(await widgetsIn(editor, 0)).toBe(0);
		await page.keyboard.type('Z');
		expect(await editor.bridge.getSource()).toBe('tag #Zfew words\n');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('tags: a paste inside a shown source leaves the caret after the pasted text', async ({
		page
	}) => {
		const editor = new PluginsPage(page);
		await open(editor, 'tags', '#few words here\n\nOther\n', 'source');
		await editor.focusBlock(1, 0);
		await editor.focusBlock(0, 2);
		await editor.seedClipboard('Q');
		await editor.paste();

		await editor.bridge.waitForSourceContains('#fQew');
		expect(await caret(editor)).toEqual({ path: [0], offset: 3 });
		await page.keyboard.type('Z');
		expect(await editor.bridge.getSource()).toBe('#fQZew words here\n\nOther\n');
		expect(await widgetsIn(editor, 0)).toBe(0);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('math: a menu trigger typed inside a shown source opens no inline menu', async ({
		page
	}) => {
		const editor = new PluginsPage(page);
		// The seed's `@` source opens a list after a space anywhere in prose.
		await open(editor, 'inline-menu', 'Sum $x$ tail\n\nNext\n', 'source');
		await clickWidgetEnd(page.locator("[data-block-path='[0]'] [data-inline-widget]"));
		await expect.poll(() => widgetsIn(editor, 0)).toBe(0);
		// `$ x$` is not math, so the `@` after its space sits in text the source still shows.
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.press('Space');
		await page.keyboard.type('@');

		expect(await editor.bridge.getSource()).toBe('Sum $ @x$ tail\n\nNext\n');
		expect(await washedRanges(editor)).toBe(1);
		await expect(page.locator('[data-inline-menu]')).toHaveCount(0);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('tags in a table cell: # keeps the caret one past it, source shown', async ({ page }) => {
		const editor = new PluginsPage(page);
		await open(editor, 'tags', '| A | B |\n| --- | --- |\n| few | ok |\n', 'source');
		await editor.focusBlockAtPath([0, 1, 0], 0);
		await page.keyboard.press('Shift+Digit3');
		expect((await caret(editor))?.offset).toBe(1);
		expect(await widgetsIn(editor, 0)).toBe(0);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('tags in a table cell: setSelection, undo and redo inside a tag open its source', async ({
		page
	}) => {
		const editor = new PluginsPage(page);
		await open(editor, 'tags', 'Other\n\n| A | B |\n| --- | --- |\n| #few | ok |\n', 'source');
		await editor.focusBlock(0, 0);
		await editor.focusBlockAtPath([1, 1, 0], 2);
		expect((await caret(editor))?.offset).toBe(2);
		expect(await widgetsIn(editor, 1)).toBe(0);

		await page.keyboard.type('a');
		expect(await editor.bridge.getSource()).toContain('| #faew | ok |');
		// The tag ends the cell's text, so End stays inside the source; Escape leaves it.
		await page.keyboard.press('Escape');
		await expect.poll(() => widgetsIn(editor, 1)).toBe(1);

		await editor.undo();
		expect(await editor.bridge.getSource()).toContain('| #few | ok |');
		expect((await caret(editor))?.offset).toBe(2);
		expect(await widgetsIn(editor, 1)).toBe(0);
		await editor.redo();
		expect(await editor.bridge.getSource()).toContain('| #faew | ok |');
		expect(await capturedErrors(page)).toEqual([]);
	});
});
