import { test, expect } from '../../fixtures';
import { attachIme } from '../../simulation/ime';
import { activeBlockPath, PluginsPage, capturedErrors } from './helpers';

/**
 * Inline menus (`editor.inlineMenus`): the list under the caret on a typed trigger. Seed
 * `inline-menu` installs a synchronous tag source on `#` and an asynchronous document picker
 * on `[[`. Requirements: e2e/requirements/plugins/inline-menu.md.
 */

const TAGS = 'harness-tags';
const DOCS = 'harness-doc-links';
/** `Type here`, the plain typing target. */
const TARGET = 2;

const menu = (editor: PluginsPage, name?: string) =>
	editor.page.locator(name ? `[data-inline-menu="${name}"]` : '[data-inline-menu]');

const rows = async (editor: PluginsPage): Promise<string[]> =>
	menu(editor).locator('[role="option"] .inline-menu-label').allTextContents();

const activeRow = (editor: PluginsPage) =>
	menu(editor).locator('[role="option"][data-active="true"] .inline-menu-label');

const activeRowId = (editor: PluginsPage): Promise<string | null> =>
	menu(editor).locator('[role="option"][data-active="true"]').getAttribute('id');

/** The element the author types in: what a screen reader is told about while a list shows. */
const editable = (editor: PluginsPage, index: number) =>
	editor.page.locator(`[data-block-path="[${index}]"] [contenteditable]`).first();

const blockRaw = async (editor: PluginsPage, index: number): Promise<string> =>
	(await editor.bridge.getSource()).split('\n\n')[index];

test.describe('inline menus', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('inline-menu');
		await editor.focusBlockEnd(TARGET);
	});

	test.afterEach(async () => {
		expect(await capturedErrors(editor.page)).toEqual([]);
	});

	test.describe('opening', () => {
		test('the trigger opens the source’s list, in the source’s order', async () => {
			await editor.typeText(' #');
			await expect(menu(editor, TAGS)).toBeVisible();
			// `project` appears twice in the seed, so it ranks first; the rest by name.
			expect(await rows(editor)).toEqual(['#project', '#inbox', '#work/admin']);
			await expect(activeRow(editor)).toHaveText('#project');
		});

		test('the query narrows the list, and Backspace widens it again', async () => {
			await editor.typeText(' #w');
			await expect.poll(() => rows(editor)).toEqual(['#work/admin']);
			await editor.page.keyboard.press('Backspace');
			await expect.poll(() => rows(editor)).toEqual(['#project', '#inbox', '#work/admin']);
		});

		test('a caret arriving beside an existing trigger opens nothing', async () => {
			// `Filed under #project and …`, a block the caret has never been in this run.
			const beforeTag = { path: [0], offset: 12 };
			await editor.bridge.setSelection({ anchor: beforeTag, focus: beforeTag });
			expect(await activeBlockPath(editor.page)).toEqual([0]);

			// Just past the `#`, then past the whole tag: neither is a trigger anyone typed.
			await editor.page.keyboard.press('ArrowRight');
			await editor.waitForRenderFlush();
			await expect(menu(editor)).toHaveCount(0);

			for (let i = 0; i < 7; i++) await editor.page.keyboard.press('ArrowRight');
			expect(await editor.bridge.getSelection()).toMatchObject({
				focus: { path: [0], offset: 20 }
			});
			await editor.waitForRenderFlush();
			await expect(menu(editor)).toHaveCount(0);
		});

		test('a mid-word hash is not a tag, and opens nothing', async () => {
			await editor.typeText('#');
			await editor.bridge.waitForSourceContains('Type here#');
			await editor.waitForRenderFlush();
			await expect(menu(editor)).toHaveCount(0);
		});

		test('a trigger inside an inline code span opens nothing', async () => {
			// `In \`code\` span`: two ArrowLefts past ` span` would be fragile, so land by offset.
			const inCode = { path: [4], offset: 6 };
			await editor.bridge.setSelection({ anchor: inCode, focus: inCode });
			await editor.typeText(' #');
			await editor.bridge.waitForSourceContains('`co #de`');
			await editor.waitForRenderFlush();
			await expect(menu(editor)).toHaveCount(0);
		});

		test('a trigger inside a link’s destination opens nothing', async () => {
			// `See [the docs](https://example.com/) here`: just past the `(`, where the tag source's
			// own rule (a `#` after a bracket opens) would otherwise say yes.
			const inUrl = { path: [5], offset: 15 };
			await editor.bridge.setSelection({ anchor: inUrl, focus: inUrl });
			await editor.typeText('#');
			await editor.bridge.waitForSourceContains('](#https://example.com/)');
			await editor.waitForRenderFlush();
			await expect(menu(editor)).toHaveCount(0);
		});

		test('two sources take their own triggers and not each other’s', async () => {
			await editor.typeText(' [[');
			await expect(menu(editor, DOCS)).toBeVisible();
			await expect(menu(editor, TAGS)).toHaveCount(0);
			expect(await rows(editor)).toEqual(['Meeting notes', 'Meal plan', 'Roadmap', 'Reading list']);
		});

		test('it opens on a line the author just started', async () => {
			await editor.page.keyboard.press('Enter');
			await editor.typeText('#');
			await expect(menu(editor, TAGS)).toBeVisible();
		});

		test('it opens in a list item', async () => {
			await editor.page.locator('[data-block-path="[3]"] [contenteditable]').first().click();
			await editor.page.keyboard.press('End');
			await editor.typeText(' #');
			await expect(menu(editor, TAGS)).toBeVisible();
		});
	});

	test.describe('what a screen reader is told', () => {
		test('the editable names the list and its active row, and drops them on Escape', async () => {
			await editor.typeText(' #');
			await expect(menu(editor, TAGS)).toBeVisible();

			const typing = editable(editor, TARGET);
			const listId = await menu(editor, TAGS).getAttribute('id');
			expect(listId).toBeTruthy();
			await expect(typing).toHaveAttribute('role', 'combobox');
			await expect(typing).toHaveAttribute('aria-expanded', 'true');
			await expect(typing).toHaveAttribute('aria-controls', listId!);
			await expect(typing).toHaveAttribute('aria-activedescendant', (await activeRowId(editor))!);

			await editor.page.keyboard.press('ArrowDown');
			await expect(activeRow(editor)).toHaveText('#inbox');
			await expect(typing).toHaveAttribute('aria-activedescendant', (await activeRowId(editor))!);

			await editor.page.keyboard.press('Escape');
			await expect(menu(editor)).toHaveCount(0);
			await expect(typing).toHaveAttribute('role', 'textbox');
			await expect(typing).not.toHaveAttribute('aria-expanded', /.*/);
			await expect(typing).not.toHaveAttribute('aria-controls', /.*/);
			await expect(typing).not.toHaveAttribute('aria-activedescendant', /.*/);
		});
	});

	test.describe('keys', () => {
		test('the arrows move the active row with wrap, and touch no byte', async () => {
			await editor.typeText(' #');
			await expect(menu(editor)).toBeVisible();
			const before = await editor.bridge.getSource();

			await editor.page.keyboard.press('ArrowDown');
			await expect(activeRow(editor)).toHaveText('#inbox');
			await editor.page.keyboard.press('ArrowUp');
			await editor.page.keyboard.press('ArrowUp');
			await expect(activeRow(editor)).toHaveText('#work/admin');

			expect(await editor.bridge.getSource()).toBe(before);
			// The caret stayed in the query: the next byte extends it.
			await editor.typeText('w');
			await editor.bridge.waitForSourceContains('Type here #w');
		});

		test('Enter commits the active row', async () => {
			await editor.typeText(' #');
			await editor.page.keyboard.press('ArrowDown');
			await editor.page.keyboard.press('Enter');
			await editor.bridge.waitForSourceContains('Type here #inbox');
			await expect(menu(editor)).toHaveCount(0);
			// Enter was the menu's: the block did not split.
			expect(await blockRaw(editor, TARGET)).toBe('Type here #inbox');
		});

		test('Tab commits too', async () => {
			await editor.typeText(' #pr');
			await expect.poll(() => rows(editor)).toEqual(['#project']);
			await editor.page.keyboard.press('Tab');
			await editor.bridge.waitForSourceContains('Type here #project');
		});

		test('Escape closes, keeps the bytes, and typing on reopens nothing', async () => {
			await editor.typeText(' #');
			await expect(menu(editor)).toBeVisible();
			await editor.page.keyboard.press('Escape');
			await expect(menu(editor)).toHaveCount(0);
			await editor.typeText('in');
			await editor.bridge.waitForSourceContains('Type here #in');
			await editor.waitForRenderFlush();
			await expect(menu(editor)).toHaveCount(0);
		});

		test('Enter during a composition is the IME’s, and commits no row', async () => {
			const ime = await attachIme(editor.page);
			await editor.typeText(' #');
			await expect(menu(editor, TAGS)).toBeVisible();

			// The composed bytes reach the document only at the end, so the caret steps out of the
			// query and the session ends there; the Enter that follows is the candidate window's.
			await ime.compose('か');
			await expect(menu(editor)).toHaveCount(0);
			await editor.page.keyboard.press('Enter');
			await ime.commit('か');

			await editor.bridge.waitForSourceContains('Type here #か');
			expect(await blockRaw(editor, TARGET)).toBe('Type here #か');
		});

		test('an empty list releases the keys: Enter splits the block', async () => {
			await editor.typeText(' #zzz');
			await editor.bridge.waitForSourceContains('#zzz');
			await expect(menu(editor)).toHaveCount(0);
			await editor.page.keyboard.press('Enter');
			await expect
				.poll(async () => (await editor.bridge.getSource()).includes('Type here #zzz\n\n'))
				.toBe(true);
		});
	});

	test.describe('commit', () => {
		test('the pick replaces trigger and query, and typing continues after it', async () => {
			await editor.typeText(' #pr');
			await expect.poll(() => rows(editor)).toEqual(['#project']);
			await editor.page.keyboard.press('Enter');
			await editor.bridge.waitForSourceContains('Type here #project');
			await editor.typeText(' next');
			await editor.bridge.waitForSourceContains('Type here #project next');
		});

		test('one undo restores the typed query', async () => {
			await editor.typeText(' #pr');
			await expect.poll(() => rows(editor)).toEqual(['#project']);
			await editor.page.keyboard.press('Enter');
			await editor.bridge.waitForSourceContains('Type here #project');

			await editor.page.keyboard.press('ControlOrMeta+z');
			await expect.poll(() => blockRaw(editor, TARGET)).toBe('Type here #pr');
		});

		test('a click on a row commits it and the document keeps its caret', async () => {
			await editor.typeText(' #');
			await menu(editor).locator('[role="option"]', { hasText: '#work/admin' }).click();
			await editor.bridge.waitForSourceContains('Type here #work/admin');
			await editor.typeText('!');
			await editor.bridge.waitForSourceContains('Type here #work/admin!');
		});

		test('an asynchronous list settles on the last query typed', async () => {
			// Typed as one burst: a read goes out per evaluation, and only the last may paint.
			await editor.typeText(' [[ro');
			await expect.poll(() => rows(editor)).toEqual(['Roadmap']);
		});

		test('a query with spaces picks a titled document', async () => {
			await editor.typeText(' [[meal p');
			await expect.poll(() => rows(editor)).toEqual(['Meal plan']);
			await editor.page.keyboard.press('Enter');
			await editor.bridge.waitForSourceContains('Type here [[Meal plan]]');
		});
	});

	test.describe('closing', () => {
		test('a query the source does not accept ends the session', async () => {
			await editor.typeText(' #pro');
			await expect(menu(editor)).toBeVisible();
			await editor.typeText(' ');
			await expect(menu(editor)).toHaveCount(0);
		});

		test('moving the caret out of the query closes the list', async () => {
			await editor.typeText(' #');
			await expect(menu(editor)).toBeVisible();
			await editor.page.keyboard.press('Home');
			await expect(menu(editor)).toHaveCount(0);
		});

		test('focus leaving the editor closes the list', async () => {
			await editor.typeText(' #');
			await expect(menu(editor)).toBeVisible();
			await editor.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
			await expect(menu(editor)).toHaveCount(0);
		});
	});

	test.describe('opening by name: a shortcut or a button', () => {
		test('open(name) types the trigger at the caret and opens there', async () => {
			await editor.page.getByTestId('open-doc-link-menu').click();
			await editor.bridge.waitForSourceContains('Type here[[');
			await expect(menu(editor, DOCS)).toBeVisible();
			await editor.typeText('road');
			await expect.poll(() => rows(editor)).toEqual(['Roadmap']);
			await editor.page.keyboard.press('Enter');
			await editor.bridge.waitForSourceContains('Type here[[Roadmap]]');
		});

		test('it opens where the typed trigger would have been declined', async () => {
			// Mid-word: typing `#` here opens nothing (above), the button does.
			await editor.page.getByTestId('open-tag-menu').click();
			await editor.bridge.waitForSourceContains('Type here#');
			await expect(menu(editor, TAGS)).toBeVisible();
		});
	});

	test.describe('a slash source: a block through onCommit', () => {
		test('the pick removes the trigger and the query, and the block lands through onCommit', async () => {
			await editor.page.keyboard.press('Enter');
			await editor.typeText('/ru');
			await expect.poll(() => rows(editor)).toEqual(['Rule']);
			await editor.page.keyboard.press('Enter');
			await editor.bridge.waitForSourceContains('---');
			expect(await editor.bridge.getSource()).not.toContain('/ru');
			expect(await editor.bridge.getBlockKind(TARGET + 1)).toBe('thematicBreak');
		});

		test('a slash inside a word opens nothing', async () => {
			await editor.typeText('/');
			await editor.bridge.waitForSourceContains('Type here/');
			await editor.waitForRenderFlush();
			await expect(menu(editor)).toHaveCount(0);
		});
	});

	test('menuChange reports the list appearing and going', async () => {
		await editor.page.evaluate(() => (window as any).__test.startMenuChangeCapture());
		await editor.typeText(' #');
		await expect(menu(editor)).toBeVisible();
		await editor.page.keyboard.press('Escape');
		await expect(menu(editor)).toHaveCount(0);
		expect(
			await editor.page.evaluate(() => (window as any).__test.stopMenuChangeCapture())
		).toEqual([true, false]);
	});
});
