import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';

// An HTML block whose kind stays put while its reading changes joins its neighbour the way a
// reload would: one that stops interrupting joins the paragraph above, and one left open reads on
// past a blank line (`requirements/text-editing/html-block-join.md`).

// Polled rather than waited on, so a red prints the bytes the editor wrote.
const expectSource = (ep: EditorPage, expected: string) =>
	expect.poll(() => ep.bridge.getSource(), { timeout: 5000 }).toBe(expected);

async function open(page: Page, mode: 'source' | 'live', doc: string): Promise<EditorPage> {
	const editor = new EditorPage(page);
	await editor.goto(mode === 'live' ? '?presentationMode=live' : '');
	await editor.loadContent(doc);
	return editor;
}

/** Selects the three characters before the tag's closing `>` on the block's first line. */
async function selectTagName(page: Page, editor: EditorPage, path: number[]): Promise<void> {
	await editor.clickBlockAtPath(path, 1);
	await page.keyboard.press('End');
	await page.keyboard.press('ArrowLeft');
	for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft');
}

/** One block on screen and in the tree, of `kind`, and a reload reads the same tree. */
async function expectOneBlock(editor: EditorPage, kind: string): Promise<void> {
	expect(await editor.bridge.getBlockCount()).toBe(1);
	expect(await editor.bridge.getBlockKind(0)).toBe(kind);
	expect(await editor.getDomBlockCount()).toBe(1);
	expect(await editor.parseConverged()).toBe(true);
}

for (const mode of ['source', 'live'] as const) {
	test.describe(`${mode} mode: an HTML block joining its neighbour`, () => {
		test('retyped so it can’t interrupt, it joins the paragraph above', async ({ page }) => {
			const editor = await open(page, mode, 'foo\n<div>\n');
			// Typed over a selection, so every key leaves an HTML block: `<s>` already can't interrupt.
			await selectTagName(page, editor, [1]);
			await page.keyboard.type('span');

			await expectSource(editor, 'foo\n<span>\n');
			await expectOneBlock(editor, 'paragraph');
		});

		test('a comment that loses its closer reads on past the blank line', async ({ page }) => {
			const editor = await open(page, mode, '<!-- note -->\n\nText\n');
			await editor.clickBlockAtPath([0], 1);
			await page.keyboard.press('End');
			await page.keyboard.press('Backspace');

			await expectSource(editor, '<!-- note --\n\nText\n');
			await expectOneBlock(editor, 'htmlBlock');
		});

		test('a div retyped as a pre reads on past the blank line', async ({ page }) => {
			const editor = await open(page, mode, '<div>\n\nfoo\n');
			await selectTagName(page, editor, [0]);
			await page.keyboard.type('pre');

			await expectSource(editor, '<pre>\n\nfoo\n');
			await expectOneBlock(editor, 'htmlBlock');
		});
	});
}

test('a comment inside a list item that loses its closer reads on past the blank line', async ({
	page
}) => {
	const editor = await open(page, 'source', '- a\n\n  <!-- x -->\n\n  b\n');
	await editor.clickBlockAtPath([0, 0, 1], 1);
	await page.keyboard.press('End');
	await page.keyboard.press('Backspace');

	await expectSource(editor, '- a\n\n  <!-- x --\n\n  b\n');
	expect(await editor.parseConverged()).toBe(true);
});

// An HTML block registers no paste handling, so the paste dispatch reports its fallthrough.
test.describe('a paste into an HTML block', () => {
	test.use({ expectWarns: ['paste-dispatch'] });

	test('a pre pasted over a div reads on past the blank line', async ({ page }) => {
		const editor = await open(page, 'source', '<div>\n\nfoo\n');
		await selectTagName(page, editor, [0]);
		await editor.seedClipboard('pre');
		await editor.paste();

		await expectSource(editor, '<pre>\n\nfoo\n');
		await expectOneBlock(editor, 'htmlBlock');
	});
});
