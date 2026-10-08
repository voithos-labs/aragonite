import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';
import { nativeSelectionText, pastLineEnd } from './multi-click-helpers';
import { textRunCenter } from '../../text-runs';
import { nextRow } from '../presentation/helpers';

// The word level of the click order (`requirements/selection/multi-click-word.md`), driven with
// real double-clicks on the plugins page so a rendered formula stands beside the word.

test.describe('multi-click: the word inline syntax handler', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('math');
	});

	async function doubleClickOn(needle: string): Promise<void> {
		const at = await textRunCenter(editor.page, needle);
		await editor.page.mouse.dblclick(at.x, at.y);
	}

	/** Loads `doc` and double-clicks `needle`, expecting `word` and nothing beside it. */
	async function wordAt(doc: string, needle: string, word: string): Promise<void> {
		await nextRow(editor, doc);
		await doubleClickOn(needle);
		await expect.poll(() => nativeSelectionText(editor.page)).toBe(word);
	}

	for (const mode of ['source', 'live'] as const) {
		test(`${mode}: a double-click takes the word alone`, async ({ page }) => {
			await editor.setPresentationMode(mode);

			await test.step('before an inline formula', async () => {
				await nextRow(editor, 'word $x^2$ after\n');
				await expect(page.locator('[data-inline-widget]')).toHaveCount(1);
				await doubleClickOn('word');
				await expect.poll(() => nativeSelectionText(page)).toBe('word');
			});

			await test.step('before an entity glyph, dropping its trailing space', async () => {
				await wordAt('a word &copy; after\n', 'word', 'word');
			});

			if (mode === 'live') {
				await test.step('the markers around a word never join it', async () => {
					await wordAt('some _ital_ words\n', 'ital', 'ital');
				});
			} else {
				await test.step('a word in a table cell, a code block and past a line end', async () => {
					await wordAt('| a | b |\n| --- | --- |\n| one two | c |\n', 'two', 'two');
					await wordAt('```\nconst value = 1\n```\n', 'value', 'value');

					await nextRow(editor, 'alpha beta gamma\n');
					const at = await pastLineEnd(page, 'gamma');
					await page.mouse.dblclick(at.x, at.y);
					await expect.poll(() => nativeSelectionText(page)).toBe('gamma');
				});
			}
		});
	}

	test('typing over the word replaces it and nothing else', async ({ page }) => {
		await editor.loadContent('alpha beta gamma\n');
		await doubleClickOn('beta');
		await expect.poll(() => nativeSelectionText(page)).toBe('beta');
		await page.keyboard.type('X');
		await editor.bridge.waitForSourceEquals('alpha X gamma\n');
	});
});
