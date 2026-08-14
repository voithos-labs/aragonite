import { test, expect } from '../../fixtures';
import { PluginsPage, readDoc, waitForDoc, activeBlockPath } from './helpers';
import { wholeBlockInput } from '../../whole-block-input';

/**
 * Whole-block focus on a BROKEN mermaid fence (requirements/plugins/mermaid-broken-focus.md). The
 * error card is still THE block: arrows stop and focus it, the two-step delete works, Enter-below
 * works, reorder works, and both edit affordances stay reachable — the user's recovery path to fix
 * the source.
 */

const DOC = 'Above text\n\n```mermaid\nnotadiagram broken\n```\n\ntail text\n';
const BROKEN_CODE = 'notadiagram broken';
const FIXED_CODE = 'graph TD\nA --> B';

class BrokenMermaidPage extends PluginsPage {
	async setup(): Promise<void> {
		await this.gotoPlugins('mermaid');
		await this.loadContent(DOC);
		await expect(this.page.locator('.mermaid-error')).toBeVisible({ timeout: 30_000 });
	}

	get surface() {
		return this.page.locator('.mermaid-surface');
	}

	/** Where whole-block focus lands: the error card is a declared surface a redraw replaces,
	 *  so the editing host lives in the chrome box beside it. */
	get inputHost() {
		return wholeBlockInput(this.page.locator('.mermaid-block'));
	}

	get textarea() {
		return this.page.getByTestId('mermaid-source');
	}
}

test.describe('mermaid broken-fence whole-block focus', () => {
	let editor: BrokenMermaidPage;

	test.beforeEach(async ({ page }) => {
		editor = new BrokenMermaidPage(page);
		await editor.setup();
	});

	test('ArrowUp from below stops on the broken block and focuses its error surface; a second ArrowUp exits above', async ({
		page
	}) => {
		await editor.getBlock(2).click();
		await page.keyboard.press('ArrowUp');
		await expect(editor.inputHost).toBeFocused();
		expect(await activeBlockPath(page)).toEqual([1]);

		await page.keyboard.press('ArrowUp');
		expect(await activeBlockPath(page)).toEqual([0]);
	});

	test('Backspace at offset 0 below focuses the broken block; a second Backspace deletes it; one undo restores it', async ({
		page
	}) => {
		const original = await editor.bridge.getSource();

		await editor.getBlock(2).click();
		await page.keyboard.press('Home');
		await page.keyboard.press('Backspace');
		await expect(editor.inputHost).toBeFocused();
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(original); // focus only — no byte change

		await page.keyboard.press('Backspace');
		await waitForDoc(page, (s) => !s.kinds.includes('mermaid'));
		expect((await readDoc(page)).kinds).toEqual(['paragraph', 'paragraph']);

		await editor.undo();
		await editor.bridge.waitForSourceEquals(original);
	});

	test('Enter while the broken block is focused inserts an empty paragraph below with the caret in it', async ({
		page
	}) => {
		await editor.surface.click();
		await expect(editor.inputHost).toBeFocused();
		await page.keyboard.press('Enter');

		await waitForDoc(page, (s) => s.rootCount === 4);
		const doc = await readDoc(page);
		expect(doc.kinds).toEqual(['paragraph', 'mermaid', 'paragraph', 'paragraph']);
		expect(doc.texts[2]).toBe('');
		expect(await activeBlockPath(page)).toEqual([2]);
	});

	test('Alt+ArrowDown reorders the broken block down and keeps it focused; Alt+ArrowUp moves it back', async ({
		page
	}) => {
		await editor.surface.click();
		await expect(editor.inputHost).toBeFocused();

		await page.keyboard.press('Alt+ArrowDown');
		await waitForDoc(page, (s) => s.kinds[2] === 'mermaid');
		expect((await readDoc(page)).kinds).toEqual(['paragraph', 'paragraph', 'mermaid']);
		await expect(editor.inputHost).toBeFocused();

		await page.keyboard.press('Alt+ArrowUp');
		await waitForDoc(page, (s) => s.kinds[1] === 'mermaid');
	});

	test('the Edit button opens the broken source; committing a fix renders the diagram and focuses it', async ({
		page
	}) => {
		const block = page.locator('.mermaid-block');
		await block.hover();
		await block.getByTestId('mermaid-edit').click();
		await expect(editor.textarea).toHaveValue(BROKEN_CODE);

		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type(FIXED_CODE);
		await page.keyboard.press('Control+Enter');

		await expect(page.locator('.mermaid-viewport svg')).toHaveCount(1, { timeout: 30_000 });
		await expect(editor.inputHost).toBeFocused();
		expect(await editor.bridge.getSource()).toContain(FIXED_CODE);
	});

	test('double-clicking the error card opens edit mode seeded with the broken source', async () => {
		await editor.surface.dblclick();
		await expect(editor.textarea).toHaveValue(BROKEN_CODE);
	});
});
