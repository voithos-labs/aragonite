import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';
import { MermaidPage, STANDARD_DIAGRAM_DOC } from './mermaid-helpers';
import { clickInPlace, hoverInPlace } from '../../click-in-place';
import { edgeKey } from '../../platform-keys';

/**
 * The text typed in the diagram's edit box and not yet written, when something other than the box
 * ends the edit: an undo, a mode switch, a new document, the box scrolled out of the window
 * (requirements/plugins/mermaid-box-save.md). Every row is 0.11.5's behaviour, mounted on its export.
 */

const source = (page: Page) => page.evaluate(() => (window as any).__test.getSource() as string);
const run = (page: Page, id: string) =>
	page.evaluate((id) => (window as any).__test.runCommand(id) as boolean, id);
const undoDepth = (page: Page) => page.evaluate(() => (window as any).__test.undoDepth() as number);
const caret = (page: Page) =>
	page.evaluate(() => {
		const focus = (window as any).__test.getSelection()?.focus;
		return focus && { path: focus.path as number[], offset: focus.offset as number };
	});

/** The box opened from the toolbar's Edit button, its textarea focused. */
async function openBox(editor: MermaidPage): Promise<void> {
	await hoverInPlace(editor.block);
	await clickInPlace(editor.block.getByTestId('mermaid-edit'));
	await expect(editor.textarea).toBeFocused();
}

const WRITTEN = STANDARD_DIAGRAM_DOC.replace('Above text', 'Above text!');
const TYPED = WRITTEN.replace('B[Finish]\n', 'B[Finish]\n\tB --> C\n');

test.describe("the diagram box's unwritten text", () => {
	let editor: MermaidPage;

	// A `!` typed at the end of the line above, then a line typed at the end of the box.
	test.beforeEach(async ({ page }) => {
		editor = new MermaidPage(page);
		await editor.loadDiagram(STANDARD_DIAGRAM_DOC);
		await clickInPlace(editor.getBlock(0));
		await page.keyboard.press(edgeKey('lineEnd'));
		await page.keyboard.type('!');
		await openBox(editor);
		await page.keyboard.press(edgeKey('blockEnd'));
		await page.keyboard.type('\n\tB --> C');
	});

	test('an undo the editor runs saves it as the step it takes back, so a redo writes it', async ({
		page
	}) => {
		expect(await run(page, 'history.undo')).toBe(true);
		await expect(editor.textarea).toHaveCount(0);
		await expect.poll(() => source(page)).toBe(WRITTEN);
		expect(await undoDepth(page)).toBe(1);
		await run(page, 'history.redo');
		await expect.poll(() => source(page)).toBe(TYPED);
	});

	test('a switch to live mode writes it as one step, which the next undo takes back', async ({
		page
	}) => {
		await editor.setPresentationMode('live');
		await expect.poll(() => source(page)).toBe(TYPED);
		expect(await undoDepth(page)).toBe(2);
		await run(page, 'history.undo');
		await expect.poll(() => source(page)).toBe(WRITTEN);
	});

	test('a new document drops it', async ({ page }) => {
		await editor.loadContent('Other doc\n');
		await expect.poll(() => source(page)).toBe('Other doc\n');
		expect(await undoDepth(page)).toBe(0);
	});
});

test.describe('a diagram box scrolled out of the window', () => {
	test('writes its text as it leaves, one undo step', async ({ page }) => {
		const editor = new MermaidPage(page);
		await editor.gotoPlugins('mermaid');
		const filler = Array.from({ length: 400 }, (_, i) => `Paragraph ${i} lorem ipsum dolor`);
		await editor.loadContent(['```mermaid\ngraph TD\n```', ...filler].join('\n\n') + '\n');
		await editor.settleDiagram('svg');
		await openBox(editor);
		await page.keyboard.press(edgeKey('blockEnd'));
		await page.keyboard.type('\nA --> B');
		await editor.scrollEditorTo(1_000_000);
		await expect(editor.textarea).toHaveCount(0);
		await expect.poll(() => source(page)).toMatch(/^```mermaid\ngraph TD\nA --> B\n```\n/);
		expect(await undoDepth(page)).toBe(1);
	});
});

test.describe("history keys in the diagram's box", () => {
	// One character typed, so the box's own undo takes it straight back to the text it opened on.
	test("once typed in, Ctrl+Z and Ctrl+Shift+Z are the box's own, and the editor's stack stands", async ({
		page
	}) => {
		const editor = new MermaidPage(page);
		await editor.loadDiagram(STANDARD_DIAGRAM_DOC);
		await clickInPlace(editor.getBlock(0));
		await page.keyboard.press(edgeKey('lineEnd'));
		await page.keyboard.type('!');
		await openBox(editor);
		await page.keyboard.press(edgeKey('blockEnd'));
		await page.keyboard.type('X');

		await page.keyboard.press('ControlOrMeta+z');
		await expect(editor.textarea).not.toHaveValue(/X$/);
		await page.keyboard.press('ControlOrMeta+Shift+z');

		await expect(editor.textarea).toHaveValue(/X$/);
		expect(await source(page)).toBe(WRITTEN);
		expect(await undoDepth(page)).toBe(1);
	});
});

test.describe("an empty diagram's box between two paragraphs", () => {
	test('hands an up or down arrow on at the column it came in with', async ({ page }) => {
		const editor = new PluginsPage(page);
		await editor.gotoPlugins('mermaid');
		await editor.loadContent('Above text here\n\n```mermaid\n```\n\ntail text here\n');
		await clickInPlace(editor.getBlock(0));
		await page.keyboard.press(edgeKey('lineStart'));
		for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowDown');
		await expect(page.getByTestId('mermaid-source')).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect.poll(() => caret(page)).toEqual({ path: [2], offset: 4 });
		await page.keyboard.press('ArrowUp');
		await expect(page.getByTestId('mermaid-source')).toBeFocused();
		await page.keyboard.press('ArrowUp');
		await expect.poll(() => caret(page)).toEqual({ path: [0], offset: 4 });
	});
});
