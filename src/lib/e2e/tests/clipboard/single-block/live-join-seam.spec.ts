import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import type { Page } from '@playwright/test';

// A paste over a single-block selection is a delete-then-insert, and its delete half is a join
// like any other: in live the runs the cut strands are bytes the reader never saw, so pasting
// them into view is the leak this pins. Every other merge site already crossed the seam; the
// paste surfaces spliced their own bytes instead.
// Requirements: e2e/requirements/clipboard/single-block/live-join-seam.md.

const DOC = 'Some **bold** text\n\nX\n';

/** What the block SHOWS: its text minus every span a marker-hiding mode paints nothing for. */
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

/** Select from inside `**bold**` out past its closer — the range whose literal cut strands `**`. */
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
		await page.keyboard.press('ControlOrMeta+v');
		// The construct is what the cut consumes, so its disappearance is the transition to
		// wait on — the seam's own bytes are the thing under test and cannot be the predicate.
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
		await page.keyboard.press('ControlOrMeta+v');
		await ep.bridge.waitForSourceContains('Some **bX');

		// Every marker is painted here, so the cut is the user's own bytes and nothing is dropped.
		expect(await ep.bridge.getSource()).toContain('Some **bX');
	});
});
