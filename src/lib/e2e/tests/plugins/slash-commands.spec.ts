import { test, expect } from '../../fixtures';
import { activeBlockPath, PluginsPage, capturedErrors } from './helpers';

/**
 * The bundled slash-commands plugin on the `inline-menu` seed, typed through the keyboard.
 * Requirements: e2e/requirements/plugins/slash-commands.md.
 */

const SLASH = 'slash-commands';
/** `Type here`, the plain typing target. */
const TARGET = 2;

const menu = (editor: PluginsPage) => editor.page.locator(`[data-inline-menu="${SLASH}"]`);
const rows = (editor: PluginsPage): Promise<string[]> =>
	menu(editor).locator('[role="option"] .inline-menu-label').allTextContents();
const details = (editor: PluginsPage): Promise<string[]> =>
	menu(editor).locator('[role="option"] .inline-menu-detail').allTextContents();
const blocks = async (editor: PluginsPage): Promise<string[]> =>
	(await editor.bridge.getSource()).split('\n\n');

test.describe('slash commands', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('inline-menu');
		await editor.focusBlockEnd(TARGET);
	});

	test.afterEach(async () => {
		expect(await capturedErrors(editor.page)).toEqual([]);
	});

	test.describe('picks', () => {
		test('/code js on an empty line leaves a js fence with the caret inside', async () => {
			await editor.page.keyboard.press('Enter');
			await editor.typeText('/code js');
			await expect.poll(() => rows(editor)).toEqual(['Code block']);
			expect(await details(editor)).toEqual(['js']);
			await editor.page.keyboard.press('Enter');
			await editor.bridge.waitForSourceContains('```js\n');
			await editor.typeText('x');
			await editor.bridge.waitForSourceContains('Type here\n\n```js\nx\n```\n\n- item');
			expect(await editor.bridge.getBlockKind(TARGET + 1)).toBe('fencedCode');
			expect(await editor.bridge.getSource()).not.toContain('/code');
		});

		test('/table 3x4 on an empty line leaves a three-by-four grid', async () => {
			await editor.page.keyboard.press('Enter');
			await editor.typeText('/table 3x4');
			await expect.poll(() => details(editor)).toEqual(['3×4']);
			await editor.page.keyboard.press('Enter');
			const grid =
				'| Column | Column | Column |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n|  |  |  |';
			await editor.bridge.waitForSourceContains(grid);
			expect(await editor.bridge.getBlockKind(TARGET + 1)).toBe('table');
		});

		test('/h2 at the end of a text line turns it into a heading, text intact', async () => {
			await editor.typeText(' /h2');
			await expect.poll(() => rows(editor)).toEqual(['Heading 2']);
			await editor.page.keyboard.press('Enter');
			await expect.poll(async () => (await blocks(editor))[TARGET]).toBe('## Type here ');
		});

		test('/h then Enter on an empty line makes a level-1 heading, not a divider', async () => {
			await editor.page.keyboard.press('Enter');
			await editor.typeText('/h');
			await expect.poll(async () => (await rows(editor))[0]).toBe('Heading 1');
			await editor.page.keyboard.press('Enter');
			await expect.poll(() => editor.bridge.getBlockKind(TARGET + 1)).toBe('heading');
			expect(await editor.bridge.getSource()).not.toContain('---');
		});

		test('/quote at the end of a text line lands a quote below, the line untouched', async () => {
			await editor.typeText(' /quote');
			await expect.poll(() => rows(editor)).toEqual(['Quote']);
			await editor.page.keyboard.press('Enter');
			await expect.poll(() => editor.bridge.getBlockKind(TARGET + 1)).toBe('blockquote');
			expect((await blocks(editor))[TARGET]).toBe('Type here ');
			expect((await activeBlockPath(editor.page))?.[0]).toBe(TARGET + 1);
		});
	});

	test.describe('undo', () => {
		/** Picks the one row `/quote` lists, then waits for the quote and the caret inside it. */
		async function pickQuote(at: number): Promise<void> {
			await expect.poll(() => rows(editor)).toEqual(['Quote']);
			await editor.page.keyboard.press('Enter');
			await expect.poll(() => editor.bridge.getBlockKind(at)).toBe('blockquote');
			await expect.poll(async () => (await activeBlockPath(editor.page))?.[0]).toBe(at);
			await editor.waitForRenderFlush();
		}

		test('/quote after text: one Ctrl+Z restores the query with the caret after it', async () => {
			await editor.typeText(' /quote');
			const typed = await editor.bridge.getSource();
			await pickQuote(TARGET + 1);

			await editor.undo();
			await editor.bridge.waitForSourceEquals(typed);
			expect(await editor.bridge.getSelection()).toMatchObject({
				focus: { path: [TARGET], offset: 'Type here /quote'.length }
			});
			await editor.redo();
			await expect.poll(() => editor.bridge.getBlockKind(TARGET + 1)).toBe('blockquote');
		});

		test('/quote on an empty line: one Ctrl+Z restores the query line', async () => {
			await editor.page.keyboard.press('Enter');
			await editor.typeText('/quote');
			const typed = await editor.bridge.getSource();
			await pickQuote(TARGET + 1);

			await editor.undo();
			await editor.bridge.waitForSourceEquals(typed);
			expect(await editor.bridge.getSelection()).toMatchObject({
				focus: { path: [TARGET + 1], offset: '/quote'.length }
			});
		});
	});

	test.describe('opening', () => {
		test('a slash inside a word opens nothing', async () => {
			await editor.typeText(' and/or 9/22');
			await editor.bridge.waitForSourceContains('Type here and/or 9/22');
			await editor.waitForRenderFlush();
			await expect(menu(editor)).toHaveCount(0);
		});

		test('a row draws its glyph beside the label', async () => {
			await editor.typeText(' /quote');
			await expect(menu(editor).locator('[role="option"] .md-menu-icon svg')).toHaveCount(1);
		});

		test('Mod+/ types the slash on an empty line and opens the list there', async () => {
			const before = await editor.bridge.getBlockCount();
			await editor.page.keyboard.press('Enter');
			await editor.bridge.waitForBlockCount(before + 1);
			await editor.page.keyboard.press('ControlOrMeta+/');
			await expect(menu(editor)).toBeVisible();
			await expect.poll(() => editor.bridge.getSource()).toContain('Type here\n\n/\n\n- item');
			await editor.typeText('ta');
			await expect.poll(() => rows(editor)).toEqual(['To-do list', 'Table']);
		});

		test('runCommand with a query opens the list already narrowed', async () => {
			await editor.page.keyboard.press('Enter');
			const ran = await editor.page.evaluate(
				() => (window as any).__test.runCommand('slashCommands.open', 'table') as boolean
			);
			expect(ran).toBe(true);
			await expect.poll(() => rows(editor)).toEqual(['Table']);
			await expect.poll(() => editor.bridge.getSource()).toContain('Type here\n\n/table\n\n- item');
		});
	});

	test.describe('a table cell', () => {
		// The tag after the table gives the tag list a row to show, were it to open.
		const TABLE = '| a | b |\n| --- | --- |\n| c |  |\n\nFiled under #work\n';
		const anyMenu = (editor: PluginsPage) => editor.page.locator('[data-inline-menu]');

		test.beforeEach(async () => {
			await editor.loadContent(TABLE);
			// Row-major: the empty cell beside `c`.
			await editor.page.locator('.table-cell').nth(3).click();
		});

		test('/quote in an empty cell stays text and opens nothing', async () => {
			await editor.typeText('/quote');
			await editor.bridge.waitForSourceContains('/quote');
			await editor.waitForRenderFlush();
			await expect(anyMenu(editor)).toHaveCount(0);
			expect(await editor.bridge.getBlockCount()).toBe(2);
		});

		test('Mod+/ in a cell declines, writing nothing', async () => {
			await editor.page.keyboard.press('ControlOrMeta+/');
			await editor.waitForRenderFlush();
			await expect(anyMenu(editor)).toHaveCount(0);
			expect(await editor.bridge.getSource()).not.toContain('/');
		});

		test('a tag typed in a cell opens no tag list', async () => {
			await editor.typeText('#wo');
			await editor.bridge.waitForSourceContains('#wo |');
			await editor.waitForRenderFlush();
			await expect(anyMenu(editor)).toHaveCount(0);
		});
	});

	test.describe('leaving without a pick', () => {
		test('/something, Escape, then ` more`: the bytes stay, the caret after them', async () => {
			await editor.page.keyboard.press('Enter');
			await editor.typeText('/something');
			await editor.page.keyboard.press('Escape');
			await editor.typeText(' more');
			await editor.bridge.waitForSourceContains('/something more');
			await expect(menu(editor)).toHaveCount(0);
			expect(await editor.bridge.getSelection()).toMatchObject({
				focus: { path: [TARGET + 1], offset: '/something more'.length }
			});
		});

		test('Escape on a showing list closes it, and typing on does not reopen it', async () => {
			await editor.page.keyboard.press('Enter');
			await editor.typeText('/s');
			await expect(menu(editor)).toBeVisible();
			await editor.page.keyboard.press('Escape');
			await expect(menu(editor)).toHaveCount(0);
			await editor.typeText('e');
			await editor.bridge.waitForSourceContains('/se');
			await editor.waitForRenderFlush();
			await expect(menu(editor)).toHaveCount(0);
			expect(await editor.bridge.getSelection()).toMatchObject({
				focus: { path: [TARGET + 1], offset: 3 }
			});
		});

		test('/zzz lists nothing, so Enter splits the line like plain text', async () => {
			await editor.page.keyboard.press('Enter');
			await editor.typeText('/zzz');
			await editor.bridge.waitForSourceContains('/zzz');
			await expect(menu(editor)).toHaveCount(0);
			const before = await editor.bridge.getBlockCount();
			await editor.page.keyboard.press('Enter');
			await editor.bridge.waitForBlockCount(before + 1);
			expect(await editor.bridge.getSource()).toContain('Type here\n\n/zzz\n\n');
		});
	});
});
