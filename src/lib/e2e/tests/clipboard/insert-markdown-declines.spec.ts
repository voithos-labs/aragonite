import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// The three states where insertMarkdown has nowhere to insert
// (requirements/clipboard/insert-markdown-declines.md). Each asserts BOTH halves of a
// decline: the false return and an untouched document. Each then LIFTS its one condition and
// requires the same payload through, so a door that declined for an unrelated reason — or
// stopped working entirely — cannot read as three passing decline gates.

// paragraph, table, fencedCode, paragraph — the eligible gap boundary is 2.
const GAP_FIXTURE = 'para\n\n| a | b |\n| - | - |\n| c | d |\n\n```\ncode\n```\n\ntail\n';
// A table is ONE `data-block-path`; its cells are addressed row-major, so `d` is 3.
const LAST_CELL = 3;
const TAIL_BLOCK = 3;

test.describe('insertMarkdown — declines', () => {
	let editor: EditorPage;

	const insert = (md: string): Promise<boolean> =>
		editor.page.evaluate((text) => (window as any).__test.insertMarkdown(text) as boolean, md);

	async function expectDeclinedWithoutMutation(): Promise<void> {
		const before = await editor.bridge.getSource();
		expect(await insert('inserted\n')).toBe(false);
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);
	}

	/** The positive control: the same call, the same payload, one condition lifted. */
	async function expectAccepted(): Promise<void> {
		expect(await insert('inserted\n')).toBe(true);
		await editor.bridge.waitForSourceContains('inserted');
	}

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('an unfocused editor declines; focus alone lets the same payload through', async () => {
		await editor.loadContent('alpha\n');
		await editor.focusBlockEnd(0);
		await editor.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

		await expectDeclinedWithoutMutation();

		await editor.focusBlockEnd(0);
		await expectAccepted();
	});

	test('reading mode declines; leaving it lets the same payload through', async () => {
		await editor.loadContent('alpha\n');
		await editor.focusBlockEnd(0);
		await editor.page.evaluate(() => (window as any).__test.setPresentationMode('reading'));

		await expectDeclinedWithoutMutation();

		// Reading clears the caret, so the control restores both the mode and a caret to insert at.
		await editor.page.evaluate(() => (window as any).__test.setPresentationMode('source'));
		await editor.focusBlockEnd(0);
		await expectAccepted();
	});

	test('a parked gap caret declines; a caret in a real block takes the same payload', async () => {
		await editor.loadContent(GAP_FIXTURE);
		await editor.page.locator('[role="cell"]').nth(LAST_CELL).click();
		await editor.page.keyboard.press('ArrowDown');
		await editor.bridge.waitForGapCaret({ parentPath: [], index: 2 });

		await expectDeclinedWithoutMutation();

		// The gap's clearing rules live at the caret doors, so leaving it is a real
		// gesture; a bare programmatic DOM write claims nothing and the gap survives it.
		await editor.page.keyboard.press('ArrowDown');
		await editor.focusBlockEnd(TAIL_BLOCK);
		await expectAccepted();
	});
});
