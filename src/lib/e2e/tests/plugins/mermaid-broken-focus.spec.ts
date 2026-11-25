import { test, expect } from '../../fixtures';
import { readDoc, waitForDoc, activeBlockPath } from './helpers';
import { MermaidPage, settleDiagrams } from './mermaid-helpers';
import { multiClickElement } from '../../multi-click';
import { edgeKey } from '../../platform-keys';

/**
 * Whole-block focus on a broken mermaid fence (requirements/plugins/mermaid-broken-focus.md). The
 * error box is still the block: arrows stop and focus it, the two-step delete works, Enter below
 * works, reorder works, and both ways into editing stay reachable, which is how the user fixes
 * the source.
 */

const DOC = 'Above text\n\n```mermaid\nnotadiagram broken\n```\n\ntail text\n';
const BROKEN_CODE = 'notadiagram broken';
const FIXED_CODE = 'graph TD\nA --> B';

class BrokenMermaidPage extends MermaidPage {
	get surface() {
		return this.page.locator('.mermaid-surface');
	}
}

test.describe('mermaid broken-fence whole-block focus', () => {
	let editor: BrokenMermaidPage;

	test.beforeEach(async ({ page }) => {
		editor = new BrokenMermaidPage(page);
		await editor.loadDiagram(DOC, 'error');
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
		await page.keyboard.press(edgeKey('lineStart'));
		await editor.pressDeclined('Backspace');
		await expect(editor.inputHost).toBeFocused();
		expect(await editor.bridge.getSource()).toBe(original); // focus only — no byte change

		await page.keyboard.press('Backspace');
		await waitForDoc(page, (s) => !s.kinds.includes('mermaid/diagram'));
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
		expect(doc.kinds).toEqual(['paragraph', 'mermaid/diagram', 'paragraph', 'paragraph']);
		expect(doc.texts[2]).toBe('');
		expect(await activeBlockPath(page)).toEqual([2]);
	});

	test('Alt+ArrowDown reorders the broken block down and keeps it focused; Alt+ArrowUp moves it back', async ({
		page
	}) => {
		await editor.surface.click();
		await expect(editor.inputHost).toBeFocused();

		await page.keyboard.press('Alt+ArrowDown');
		await waitForDoc(page, (s) => s.kinds[2] === 'mermaid/diagram');
		expect((await readDoc(page)).kinds).toEqual(['paragraph', 'paragraph', 'mermaid/diagram']);
		await expect(editor.inputHost).toBeFocused();

		await page.keyboard.press('Alt+ArrowUp');
		await waitForDoc(page, (s) => s.kinds[1] === 'mermaid/diagram');
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
		await page.keyboard.press('ControlOrMeta+Enter');

		await settleDiagrams(page);
		await expect(editor.inputHost).toBeFocused();
		expect(await editor.bridge.getSource()).toContain(FIXED_CODE);
	});

	test('double-clicking the error card opens edit mode seeded with the broken source', async () => {
		await multiClickElement(editor.surface, 2);
		await expect(editor.textarea).toHaveValue(BROKEN_CODE);
	});
});
