import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';

// A cell's destructive edits cross the same join seam as prose: in live the runs a cut strands
// are bytes the reader never saw, and the escaping sink runs after the seam.
// Requirements: e2e/requirements/presentation/presentation-live-cell-join.md.

const DOC = '| Some **bold** *it* x | y |\n| --- | --- |\n| a | b |\n';
const CELL_PATH = [0, 0, 0];

/** From inside `**bold**` (after "bo") to inside `*it*` (after "i"), by CST path. */
async function selectAcrossConstructs(ep: EditorPage): Promise<void> {
	await ep.bridge.setSelection({
		anchor: { path: CELL_PATH, offset: 9 },
		focus: { path: CELL_PATH, offset: 16 }
	});
	await ep.waitForRenderFlush();
}

/** The cell's visible text: its DOM text minus every marker span. */
async function visibleCellText(page: Page): Promise<string> {
	return page.evaluate(() => {
		const cell = document.querySelector('[role="cell"]');
		if (!cell) return '';
		const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
		let out = '';
		let node: Node | null;
		while ((node = walker.nextNode())) {
			if (!node.parentElement?.closest('.md-marker')) out += node.textContent ?? '';
		}
		return out;
	});
}

test.describe('live mode — destructive edits inside a table cell', () => {
	test('Mod+X drops the stranded runs and copies the raw slice', async ({ page }) => {
		const ep = new EditorPage(page);
		await ep.goto('?presentationMode=live');
		await ep.loadContent(DOC);
		await ep.waitForRenderFlush();

		await selectAcrossConstructs(ep);
		await page.keyboard.press('ControlOrMeta+x');
		await ep.bridge.waitForSourceContains('| Some bot x | y |');

		expect(await visibleCellText(page)).not.toContain('*');
		expect(await ep.readClipboard()).toBe('ld** *i');
	});

	test('typing over the selection lands the character at the cleaned seam', async ({ page }) => {
		const ep = new EditorPage(page);
		await ep.goto('?presentationMode=live');
		await ep.loadContent(DOC);
		await ep.waitForRenderFlush();

		await selectAcrossConstructs(ep);
		await page.keyboard.press('Z');
		await ep.bridge.waitForSourceContains('| Some boZt x | y |');

		expect(await visibleCellText(page)).not.toContain('*');
	});

	test('Mod+Z after the cut restores the original cell bytes', async ({ page }) => {
		const ep = new EditorPage(page);
		await ep.goto('?presentationMode=live');
		await ep.loadContent(DOC);
		await ep.waitForRenderFlush();

		await selectAcrossConstructs(ep);
		await page.keyboard.press('ControlOrMeta+x');
		await ep.bridge.waitForSourceContains('| Some bot x | y |');

		await page.keyboard.press('ControlOrMeta+z');
		await ep.bridge.waitForSourceContains('| Some **bold** *it* x | y |');
	});

	test('source mode: the same cut stays byte-literal', async ({ page }) => {
		const ep = new EditorPage(page);
		await ep.goto();
		await ep.loadContent(DOC);
		await ep.waitForRenderFlush();

		await selectAcrossConstructs(ep);
		await page.keyboard.press('ControlOrMeta+x');
		await ep.bridge.waitForSourceContains('| Some **bot* x | y |');
	});
});
