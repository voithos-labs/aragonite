// Requirements: e2e/requirements/blocks/list/task-checkbox.md
import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

async function waitForSourceContains(editor: EditorPage, needle: string): Promise<void> {
	await editor.page.waitForFunction(
		(s) => (window as any).__test.getSource().includes(s),
		needle
	);
}

async function computedDecoration(editor: EditorPage, selector: string): Promise<string> {
	const el = editor.page.locator(selector).first();
	return el.evaluate((n) => window.getComputedStyle(n).textDecorationLine);
}

test.describe('task checkbox — toggle and rendering', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('clicking unchecked checkbox toggles to checked', async () => {
		await editor.loadContent('- [ ] pending\n');
		await editor.page.locator('.task-checkbox').first().click();
		await waitForSourceContains(editor, '[x]');
		expect((await editor.getSource()).trim()).toBe('- [x] pending');
	});

	test('clicking checked checkbox toggles to unchecked', async () => {
		await editor.loadContent('- [x] done\n');
		await editor.page.locator('.task-checkbox').first().click();
		await waitForSourceContains(editor, '[ ]');
		expect((await editor.getSource()).trim()).toBe('- [ ] done');
	});

	test('toggle then Ctrl+Z restores pre-toggle source', async () => {
		await editor.loadContent('- [ ] task\n');
		await editor.page.locator('.task-checkbox').first().click();
		await waitForSourceContains(editor, '[x]');

		await editor.undo();
		await waitForSourceContains(editor, '[ ]');
		expect((await editor.getSource()).trim()).toBe('- [ ] task');
	});

	test('toggle → undo → redo returns to checked state', async () => {
		await editor.loadContent('- [ ] task\n');
		await editor.page.locator('.task-checkbox').first().click();
		await waitForSourceContains(editor, '[x]');

		await editor.undo();
		await waitForSourceContains(editor, '[ ]');
		await editor.redo();
		await waitForSourceContains(editor, '[x]');
		expect((await editor.getSource()).trim()).toBe('- [x] task');
	});

	test('uppercase [X] variant parses checked; toggle normalizes to lowercase', async () => {
		await editor.loadContent('- [X] upper\n');
		await editor.page.locator('.task-checkbox').first().click();
		await waitForSourceContains(editor, '[ ]');
		expect((await editor.getSource()).trim()).toBe('- [ ] upper');
	});

	test('completed task renders with strikethrough', async () => {
		await editor.loadContent('- [x] done\n');
		const deco = await computedDecoration(
			editor,
			'.list-item-block[data-task-checked="true"] .paragraph-block'
		);
		expect(deco).toContain('line-through');
	});

	test('unchecked task does not have strikethrough', async () => {
		await editor.loadContent('- [ ] pending\n');
		const deco = await computedDecoration(
			editor,
			'.list-item-block[data-task-checked="false"] .paragraph-block'
		);
		expect(deco).not.toContain('line-through');
	});

	test('checkbox span carries role=checkbox and aria-checked', async () => {
		await editor.loadContent('- [x] done\n');
		const checkbox = editor.page.locator('.task-checkbox').first();
		await expect(checkbox).toHaveAttribute('role', 'checkbox');
		await expect(checkbox).toHaveAttribute('aria-checked', 'true');
	});

	test('aria-checked flips synchronously with toggle', async () => {
		await editor.loadContent('- [ ] pending\n');
		const checkbox = editor.page.locator('.task-checkbox').first();
		await expect(checkbox).toHaveAttribute('aria-checked', 'false');
		await checkbox.click();
		await expect(checkbox).toHaveAttribute('aria-checked', 'true');
	});

	test('typing `[ ] ` at start of plain list item promotes to task item live', async () => {
		// Regression: listItem task metadata reconciles on live typing so the
		// checkbox renders immediately, no reload required.
		await editor.loadContent('- plain\n');
		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.typeSlowly('[ ] ');
		await waitForSourceContains(editor, '[ ] plain');
		await editor.page.waitForSelector('.task-checkbox', { timeout: 2000 });
		expect((await editor.getSource()).trim()).toBe('- [ ] plain');
	});

	test('typing `[x] ` at start of plain list item promotes to checked task item live', async () => {
		await editor.loadContent('- work\n');
		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.typeSlowly('[x] ');
		await waitForSourceContains(editor, '[x] work');
		await editor.page.waitForSelector('.list-item-block[data-task-checked="true"]', {
			timeout: 2000
		});
		expect((await editor.getSource()).trim()).toBe('- [x] work');
	});

	test('checkbox characters cannot be edited via keyboard', async () => {
		await editor.loadContent('- [x] task\n');
		await editor.focusBlockAtPath([0, 0, 0], 0);
		await editor.typeSlowly('Z');
		await editor.page.waitForTimeout(200);
		const source = await editor.getSource();
		expect(source).not.toContain('[Zx]');
		expect(source).not.toContain('[xZ]');
		expect(source).toContain('[x]');
	});

	test('nested task sub-list renders independently', async () => {
		await editor.loadContent('- [x] outer\n  - [ ] nested\n');
		// Outer paragraph is the direct child of the checked item (strikethrough
		// targets that level only). Nested paragraph lives inside a sub-list.
		const outerDeco = await computedDecoration(
			editor,
			'.list-item-block[data-task-checked="true"] > .list-item-content > .block-list > .block-host > .paragraph-block'
		);
		const nestedDeco = await computedDecoration(
			editor,
			'.list-item-block[data-task-checked="false"] .paragraph-block'
		);
		expect(outerDeco).toContain('line-through');
		expect(nestedDeco).not.toContain('line-through');
	});

	test('clicking checkbox with active cross-block selection collapses and toggles', async () => {
		await editor.loadContent('- [ ] first\n- [ ] second\n');

		// Shift+ArrowDown from mid-block crosses into the sibling item; from
		// offset 0 it stays inside the first block on most platforms.
		await editor.focusBlockAtPath([0, 0, 0], 5);
		await editor.pressKey('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		await editor.page.locator('.task-checkbox').first().click();
		await waitForSourceContains(editor, '[x] first');
		expect(await editor.isCrossBlockActive()).toBe(false);
		expect((await editor.getSource()).trim()).toBe('- [x] first\n- [ ] second');
	});

	test('Enter at end of checked task item creates a new unchecked task item', async () => {
		await editor.loadContent('- [x] done\n');
		await editor.focusBlockAtPath([0, 0, 0], 'done'.length);
		await editor.pressKey('Enter');
		await waitForSourceContains(editor, '- [x] done\n- [ ] ');
		expect((await editor.getSource()).trim()).toBe('- [x] done\n- [ ]');
	});

	test('Enter at end of unchecked task item creates a new unchecked task item', async () => {
		await editor.loadContent('- [ ] pending\n');
		await editor.focusBlockAtPath([0, 0, 0], 'pending'.length);
		await editor.pressKey('Enter');
		await waitForSourceContains(editor, '- [ ] pending\n- [ ] ');
		expect((await editor.getSource()).trim()).toBe('- [ ] pending\n- [ ]');
	});

	test('Enter at end of plain list item stays plain (control)', async () => {
		await editor.loadContent('- plain\n');
		await editor.focusBlockAtPath([0, 0, 0], 'plain'.length);
		await editor.pressKey('Enter');
		await waitForSourceContains(editor, '- plain\n- ');
		expect((await editor.getSource()).trim()).toBe('- plain\n-');
	});

	test('toggle emits exactly one metadataUpdate edit event', async () => {
		await editor.loadContent('- [ ] task\n');
		await editor.page.evaluate(() => (window as any).__test.startEditOpCapture());
		await editor.page.locator('.task-checkbox').first().click();
		await waitForSourceContains(editor, '[x]');
		const ops = await editor.page.evaluate(() =>
			(window as any).__test.stopEditOpCapture()
		);
		expect(ops).toEqual(['metadataUpdate']);
	});
});
