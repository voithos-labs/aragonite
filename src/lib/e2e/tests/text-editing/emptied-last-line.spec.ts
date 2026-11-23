import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { WORD_MODIFIER } from '../../platform-keys';

// Erasing a block's last line down to nothing leaves its line break standing, and the caret on
// the empty line after it: the next key belongs there, in every mode.

const MODES = ['source', 'live'] as const;

test.describe('text editing, a last line erased to nothing', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	for (const mode of MODES) {
		test(`the next key lands on the emptied line of a paragraph (${mode})`, async ({ page }) => {
			await editor.setPresentationMode(mode);
			await editor.loadContent('Plan\nmore\n');
			await editor.focusBlockEnd(0);
			for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');
			await expect.poll(() => editor.bridge.getSource()).toBe('Plan\n\n');
			await page.keyboard.type('x');

			await expect.poll(() => editor.bridge.getSource()).toBe('Plan\nx\n');
			expect(await editor.parseConverged()).toBe(true);
		});

		test(`the emptied line above a blank line keeps one blank line (${mode})`, async ({ page }) => {
			await editor.setPresentationMode(mode);
			await editor.loadContent('Plan\nmore\n\nnext\n');
			await editor.focusBlockEnd(0);
			for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');
			await expect.poll(() => editor.bridge.getSource()).toBe('Plan\n\nnext\n');
			expect(await editor.parseConverged()).toBe(true);

			await page.keyboard.press('Backspace');
			await expect.poll(() => editor.bridge.getSource()).toBe('Plan\n\nnext\n');
			expect(await editor.bridge.getBlockCount()).toBe(2);
			expect(await editor.parseConverged()).toBe(true);
		});
	}

	// With no final line break, the emptied last paragraph is a blank last line, which keeps its
	// break, so the next key stands alone instead of joining the paragraph above.
	for (const [name, source, path, emptied, typed] of [
		['a paragraph under a blank line', 'Plan\n\nmore', [1], 'Plan\n\n\n', 'Plan\n\nx\n'],
		['a quote’s last paragraph', '> Plan\n>\n> more', [0, 1], '> Plan\n>\n>\n', '> Plan\n>\n> x\n']
	] as const)
		for (const mode of MODES)
			test(`no final line break: ${name} erased keeps its line (${mode})`, async ({ page }) => {
				await editor.setPresentationMode(mode);
				await editor.loadContent(source);
				await editor.focusBlockAtPath([...path], 4);
				for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');
				await expect.poll(() => editor.bridge.getSource()).toBe(emptied);
				await page.keyboard.type('x');

				await expect.poll(() => editor.bridge.getSource()).toBe(typed);
				expect(await editor.parseConverged()).toBe(true);
			});

	// A last line emptied under its block's other lines is a blank last line too, so a file with
	// no final line break ends as its twin with one does, and the next key lands on that line.
	const SECOND_LINES = [
		['a paragraph', 'above\npq', [0], 8, 'above\n\n', 'above\nx\n'],
		[
			'a list item',
			'- one\n- two\n  pq',
			[0, 1, 0],
			6,
			'- one\n- two\n  \n',
			'- one\n- two\n  x\n'
		],
		['an unclosed code block', 'zz\n\n```\npq', [1], 6, 'zz\n\n```\n\n', 'zz\n\n```\nx\n'],
		['a quote', '> above\n> pq', [0, 0], 8, '> above\n>\n', '> above\n> x\n']
	] as const;
	const EMPTYING = {
		'Backspace twice': ['Backspace', 'Backspace'],
		'its text selected, Delete': ['Shift+ArrowLeft', 'Shift+ArrowLeft', 'Delete'],
		'a word delete': [`${WORD_MODIFIER}+Backspace`]
	};
	for (const [name, open, path, end, emptied, typed] of SECOND_LINES)
		for (const [file, source] of [
			['no final line break', open],
			['a final line break', `${open}\n`]
		])
			for (const [how, keys] of Object.entries(EMPTYING))
				for (const mode of MODES)
					test(`${file}: ${name}'s last line emptied by ${how} keeps its line (${mode})`, async ({
						page
					}) => {
						await editor.setPresentationMode(mode);
						await editor.loadContent(source);
						await editor.focusBlockAtPath([...path], end);
						for (const key of keys) await page.keyboard.press(key);
						await expect.poll(() => editor.bridge.getSource()).toBe(emptied);
						await page.keyboard.type('x');

						await expect.poll(() => editor.bridge.getSource()).toBe(typed);
						expect(await editor.parseConverged()).toBe(true);
					});

	// Enter at a code body's end opens the same blank last line.
	for (const [file, source] of [
		['no final line break', 'zz\n\n```\npq'],
		['a final line break', 'zz\n\n```\npq\n']
	])
		for (const mode of MODES)
			test(`${file}: Enter at an unclosed code block's end opens a line (${mode})`, async ({
				page
			}) => {
				await editor.setPresentationMode(mode);
				await editor.loadContent(source);
				await editor.focusBlockAtPath([1], 6);
				await page.keyboard.press('Enter');
				await expect.poll(() => editor.bridge.getSource()).toBe('zz\n\n```\npq\n\n');
				await page.keyboard.type('x');

				await expect.poll(() => editor.bridge.getSource()).toBe('zz\n\n```\npq\nx\n');
			});

	test('a setext underline erased above a blank line keeps one blank line (source)', async ({
		page
	}) => {
		await editor.setPresentationMode('source');
		await editor.loadContent('Plan\n===\n\nb\n');
		await editor.focusBlockEnd(0);
		for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace');

		await expect.poll(() => editor.bridge.getSource()).toBe('Plan\n\nb\n');
		expect(await editor.parseConverged()).toBe(true);
	});
});
