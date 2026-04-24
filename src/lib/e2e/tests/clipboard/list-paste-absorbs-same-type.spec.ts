import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

// Same-type list paste (ordered into ordered, unordered into unordered) should
// flatten pasted items as siblings in the enclosing list with continuous
// renumbering — not produce three separate lists (break-out) and not nest as
// a sub-list under the target item. Matches Obsidian / Google Docs convention.
// The complementary mismatched-type case is covered by
// list-paste-mismatched-breaks-out.spec.ts.
test.describe('paste: same-type list into list item flattens into enclosing list', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('ordered paste at end of ordered item: items absorb with continuous numbering', async () => {
		await editor.loadContent('1. alpha\n2. beta\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('1. x\n2. y\n'));
		await editor.page.waitForTimeout(100);

		await editor.focusBlockAtPath([0, 0, 0], 'alpha'.length);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = (await editor.getSource()).replace(/\r\n/g, '\n');
		expect(src).toMatch(/^1\. alpha$/m);
		expect(src).toMatch(/^2\. x$/m);
		expect(src).toMatch(/^3\. y$/m);
		expect(src).toMatch(/^4\. beta$/m);
		// Regressions to guard: pasted list staying its own list (1-restart)
		// or outer list resuming numbering after the gap.
		expect(src).not.toMatch(/^1\. x$/m);
		expect(src).not.toMatch(/^2\. beta$/m);
	});

	test('ordered paste in middle of ordered item: item splits and pasted items absorb between halves', async () => {
		await editor.loadContent('1. alphagamma\n2. beta\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('1. x\n2. y\n'));
		await editor.page.waitForTimeout(100);

		await editor.focusBlockAtPath([0, 0, 0], 'alpha'.length);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = (await editor.getSource()).replace(/\r\n/g, '\n');
		expect(src).toMatch(/^1\. alpha$/m);
		expect(src).toMatch(/^2\. x$/m);
		expect(src).toMatch(/^3\. y$/m);
		expect(src).toMatch(/^4\. gamma$/m);
		expect(src).toMatch(/^5\. beta$/m);
	});

	test('ordered paste at start of ordered item: items absorb before target', async () => {
		await editor.loadContent('1. alpha\n2. beta\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('1. x\n2. y\n'));
		await editor.page.waitForTimeout(100);

		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = (await editor.getSource()).replace(/\r\n/g, '\n');
		expect(src).toMatch(/^1\. x$/m);
		expect(src).toMatch(/^2\. y$/m);
		expect(src).toMatch(/^3\. alpha$/m);
		expect(src).toMatch(/^4\. beta$/m);
	});

	test('ordered paste at end of middle item: pasted items land between target and rest', async () => {
		await editor.loadContent('1. a\n2. b\n3. c\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('1. x\n2. y\n'));
		await editor.page.waitForTimeout(100);

		await editor.focusBlockAtPath([0, 1, 0], 'b'.length);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = (await editor.getSource()).replace(/\r\n/g, '\n');
		expect(src).toMatch(/^1\. a$/m);
		expect(src).toMatch(/^2\. b$/m);
		expect(src).toMatch(/^3\. x$/m);
		expect(src).toMatch(/^4\. y$/m);
		expect(src).toMatch(/^5\. c$/m);
	});

	test('unordered paste at end of unordered item: items absorb as flat siblings', async () => {
		await editor.loadContent('- a\n- b\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('- x\n- y\n'));
		await editor.page.waitForTimeout(100);

		await editor.focusBlockAtPath([0, 0, 0], 'a'.length);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = (await editor.getSource()).replace(/\r\n/g, '\n');
		expect(src).toMatch(/^- a$/m);
		expect(src).toMatch(/^- x$/m);
		expect(src).toMatch(/^- y$/m);
		expect(src).toMatch(/^- b$/m);
		// All 4 items in a single flat list — exactly 4 bullet lines.
		const bulletLines = (src.match(/^- /gm) ?? []).length;
		expect(bulletLines).toBe(4);
	});

	test('ordered paste with mismatched marker suffix normalizes to parent style', async () => {
		// Parent uses "1. " suffix; paste uses "1) " suffix. After absorb,
		// all items should share the parent's "." suffix.
		await editor.loadContent('1. alpha\n2. beta\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('1) x\n2) y\n'));
		await editor.page.waitForTimeout(100);

		await editor.focusBlockAtPath([0, 0, 0], 'alpha'.length);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = (await editor.getSource()).replace(/\r\n/g, '\n');
		expect(src).toMatch(/^1\. alpha$/m);
		expect(src).toMatch(/^2\. x$/m);
		expect(src).toMatch(/^3\. y$/m);
		expect(src).toMatch(/^4\. beta$/m);
		// No ")" suffix survives in the absorbed items.
		expect(src).not.toMatch(/^\d+\) /m);
	});

	test('single-item ordered paste at end of ordered item absorbs as one sibling', async () => {
		await editor.loadContent('1. alpha\n2. beta\n');
		await editor.page.evaluate(() => navigator.clipboard.writeText('1. only\n'));
		await editor.page.waitForTimeout(100);

		await editor.focusBlockAtPath([0, 0, 0], 'alpha'.length);
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const src = (await editor.getSource()).replace(/\r\n/g, '\n');
		expect(src).toMatch(/^1\. alpha$/m);
		expect(src).toMatch(/^2\. only$/m);
		expect(src).toMatch(/^3\. beta$/m);
	});
});
