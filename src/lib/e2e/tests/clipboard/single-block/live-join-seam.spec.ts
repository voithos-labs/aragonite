import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import type { Page } from '@playwright/test';

// A paste over a single-block selection is a delete then an insert, and its delete half is a
// join like any other: in live mode the marker runs the cut strands are bytes the user never
// saw, so pasting them into view is the leak this pins. Every other merge site already goes
// through the shared join, and the paste paths must too rather than splicing their own bytes.
// Requirements: `e2e/requirements/clipboard/single-block/live-join-seam.md`.

const DOC = 'Some **bold** text\n\nX\n';

/** What the block shows: its text minus every span a marker-hiding mode paints nothing for. */
async function visibleText(page: Page, block: number): Promise<string> {
	return page.evaluate((index) => {
		const host = document.querySelector(`[data-block-path='[${index}]']`);
		if (!host) return '';
		const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
		let out = '';
		let node: Node | null;
		while ((node = walker.nextNode())) {
			if (!node.parentElement?.closest('.md-marker, .md-ref-label, .md-fence-line')) {
				out += node.textContent ?? '';
			}
		}
		return out;
	}, block);
}

/** Copy the one-character second block, so the clipboard holds an inline payload. */
async function copyPayload(ep: EditorPage, page: Page): Promise<void> {
	await ep.focusBlock(1, 0);
	await page.keyboard.press('Shift+ArrowRight');
	await page.keyboard.press('ControlOrMeta+c');
	await ep.waitForClipboardWrite();
}

/** Select from inside `**bold**` out past its closer: the range whose literal cut strands `**`. */
async function selectAcrossTheCloser(ep: EditorPage, page: Page): Promise<void> {
	await ep.focusBlock(0, 8);
	for (let i = 0; i < 8; i++) await page.keyboard.press('Shift+ArrowRight');
	await ep.waitForRenderFlush();
}

test.describe('single-block paste over a construct edge', () => {
	test('live: the stranded delimiter goes with the cut, not onto the screen', async ({ page }) => {
		const ep = new EditorPage(page);
		await ep.goto('?presentationMode=live');
		await ep.loadContent(DOC);
		await ep.waitForRenderFlush();

		await copyPayload(ep, page);
		await selectAcrossTheCloser(ep, page);
		await ep.paste();
		// The construct is what the cut consumes, so its disappearance is the change to wait
		// on: the join's own bytes are the thing under test and cannot be the condition.
		await ep.bridge.waitForSourceNotContains('**bold**');
		await ep.waitForRenderFlush();

		expect(await visibleText(page, 0)).not.toContain('*');
		expect(await ep.bridge.getSource()).not.toContain('**b');
	});

	test('source: the same paste stays byte-literal', async ({ page }) => {
		const ep = new EditorPage(page);
		await ep.goto();
		await ep.loadContent(DOC);
		await ep.waitForRenderFlush();

		await copyPayload(ep, page);
		await selectAcrossTheCloser(ep, page);
		await ep.paste();
		await ep.bridge.waitForSourceContains('Some **bX');

		// Every marker is painted here, so the cut is the user's own bytes and nothing is dropped.
		expect(await ep.bridge.getSource()).toContain('Some **bX');
	});
});

// The same join one level down. A cell splices its own bytes and escapes them where it writes,
// and that escaping runs after the cut, which is why the shared join has to run first.
const CELL_DOC = '| Some **bold** text | y |\n| --- | --- |\n| a | b |\n\nX\n';

test.describe('table-cell paste over a construct edge', () => {
	/** The selection the prose row uses, one level down: inside `**bold**`, then past its closer. */
	async function selectAcrossTheCellCloser(ep: EditorPage, page: Page): Promise<void> {
		await page.getByRole('cell').first().click();
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();
		for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
		for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowRight');
		await ep.waitForRenderFlush();
	}

	test('live: the cell drops the run its cut stranded', async ({ page }) => {
		const ep = new EditorPage(page);
		await ep.goto('?presentationMode=live');
		await ep.loadContent(CELL_DOC);
		await ep.waitForRenderFlush();

		await copyPayload(ep, page);
		await selectAcrossTheCellCloser(ep, page);

		await ep.paste();
		await ep.bridge.waitForSourceNotContains('**bold**');
		await ep.waitForRenderFlush();

		expect(await visibleText(page, 0)).not.toContain('*');
		expect(await ep.bridge.getSource()).toContain('| Some bXxt |');
	});

	test('source: the cell paste stays byte-literal', async ({ page }) => {
		const ep = new EditorPage(page);
		await ep.goto();
		await ep.loadContent(CELL_DOC);
		await ep.waitForRenderFlush();

		await copyPayload(ep, page);
		await selectAcrossTheCellCloser(ep, page);

		await ep.paste();
		await ep.bridge.waitForSourceNotContains('**bold** text');
		await ep.waitForRenderFlush();

		// Every marker is painted here, so the cut is the user's own bytes: the selection crosses
		// the delimiters one character at a time and the halves it leaves stand exactly as cut.
		expect(await ep.bridge.getSource()).toContain('| Some *X* text |');
	});

	// The cell's own escaping and a construct in one cut: the shared join runs first, the cell
	// escapes what it wrote, and the `|` inside the cell stays escaped.
	test('live: the escape survives the seam the cut crossed', async ({ page }) => {
		const ep = new EditorPage(page);
		await ep.goto('?presentationMode=live');
		await ep.loadContent('| a\\|b **z** c | y |\n| --- | --- |\n| p | q |\n\nX\n');
		await ep.waitForRenderFlush();

		await copyPayload(ep, page);
		await page.getByRole('cell').first().click();
		await page.keyboard.press('End');
		await ep.waitForRenderFlush();
		for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft');
		await ep.waitForRenderFlush();

		await ep.paste();
		await ep.bridge.waitForSourceNotContains('**z**');
		await ep.waitForRenderFlush();

		expect(await visibleText(page, 0)).not.toContain('*');
		expect(await ep.bridge.getSource()).toContain('a\\|b');
	});
});
