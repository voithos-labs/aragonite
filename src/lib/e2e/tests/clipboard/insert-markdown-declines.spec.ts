import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// The three states where insertMarkdown has nowhere to insert
// (requirements/clipboard/insert-markdown-declines.md). Each asserts BOTH halves of a
// decline: the false return and an untouched document.

// paragraph, table, fencedCode, paragraph — the eligible gap boundary is 2.
const GAP_FIXTURE = 'para\n\n| a | b |\n| - | - |\n| c | d |\n\n```\ncode\n```\n\ntail\n';
// A table is ONE `data-block-path`; its cells are addressed row-major, so `d` is 3.
const LAST_CELL = 3;

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

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('an unfocused editor declines', async () => {
		await editor.loadContent('alpha\n');
		await editor.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

		await expectDeclinedWithoutMutation();
	});

	test('reading mode declines', async () => {
		await editor.loadContent('alpha\n');
		await editor.focusBlockEnd(0);
		await editor.page.evaluate(() => (window as any).__test.setPresentationMode('reading'));

		await expectDeclinedWithoutMutation();
	});

	test('a parked gap caret declines', async () => {
		await editor.loadContent(GAP_FIXTURE);
		await editor.page.locator('[role="cell"]').nth(LAST_CELL).click();
		await editor.page.keyboard.press('ArrowDown');
		await editor.bridge.waitForGapCaret({ parentPath: [], index: 2 });

		await expectDeclinedWithoutMutation();
	});
});
