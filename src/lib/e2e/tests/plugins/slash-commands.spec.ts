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
