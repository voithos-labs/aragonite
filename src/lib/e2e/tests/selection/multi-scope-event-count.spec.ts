// Exactly one edit event per structural op for every site using commitMultiScope.
// Requirements: e2e/requirements/selection/multi-scope-event-count.md
import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { primaryModifier } from '../../platform';

// ── Helpers ────────────────────────────────────────────────────────────────

async function countEditEvents(editor: EditorPage, action: () => Promise<void>): Promise<number> {
	await editor.page.evaluate(() => (window as any).__test.startEditCount());
	await action();
	return editor.page.evaluate(() => (window as any).__test.stopEditCount());
}

// ── indentItem ─────────────────────────────────────────────────────────────

test.describe('one edit event per op — indentItem', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Tab on list item emits exactly one edit event', async () => {
		await editor.loadContent('- Item 1\n- Item 2\n');
		const items = editor.page.locator('.list-item-block [contenteditable="true"]');
		await items.nth(1).click();

		const count = await countEditEvents(editor, async () => {
			await editor.pressKey('Tab');
			await editor.page.waitForTimeout(300);
		});

		expect(count).toBe(1);
	});
});

// ── unindentItem / promoteNestedItem ───────────────────────────────────────

test.describe('one edit event per op — unindentItem', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Shift+Tab on nested item emits exactly one edit event', async () => {
		await editor.loadContent('- Item 1\n  - Nested\n- Item 2\n');
		const nested = editor.page.locator(
			'.list-item-content .list-block .list-item-block [contenteditable="true"]'
		);
		await nested.first().click();

		const count = await countEditEvents(editor, async () => {
			await editor.pressKey('Shift+Tab');
			await editor.page.waitForTimeout(300);
		});

		expect(count).toBe(1);
	});
});

// ── splitItemAtOffset ──────────────────────────────────────────────────────

test.describe('one edit event per op — splitItemAtOffset', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter mid-item emits exactly one edit event', async () => {
		await editor.loadContent('- HelloWorld\n');
		const item = editor.page.locator('[contenteditable="true"]', { hasText: 'HelloWorld' });
		await item.click();
		await editor.pressKey('Home');
		for (let i = 0; i < 5; i++) await editor.pressKey('ArrowRight');

		const count = await countEditEvents(editor, async () => {
			await editor.pressEnter();
			await editor.page.waitForTimeout(200);
		});

		expect(count).toBe(1);
	});
});

// ── insertItemAfter ────────────────────────────────────────────────────────

test.describe('one edit event per op — insertItemAfter', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter at end of item emits exactly one edit event', async () => {
		await editor.loadContent('- Alpha\n- Beta\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'Alpha' });
		await first.click();
		await editor.pressKey('End');

		const count = await countEditEvents(editor, async () => {
			await editor.pressEnter();
			await editor.page.waitForTimeout(200);
		});

		expect(count).toBe(1);
	});
});

// ── blockquote splitBlock exit ─────────────────────────────────────────────

test.describe('one edit event per op — blockquote splitBlock exit', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter on empty trailing blockquote paragraph emits exactly one edit event', async () => {
		await editor.loadContent('> first\n>\n> \n');
		const paras = editor.page.locator('.blockquote-block [contenteditable="true"]');
		await paras.last().click();
		await editor.pressKey('Home');

		const count = await countEditEvents(editor, async () => {
			await editor.pressEnter();
			await editor.page.waitForTimeout(300);
		});

		expect(count).toBe(1);
	});
});

// ── cross-block delete ─────────────────────────────────────────────────────

test.describe('one edit event per op — cross-block delete', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Backspace on cross-block selection spanning two paragraphs emits one edit event', async () => {
		await editor.loadContent('first\n\nsecond\n');
		await editor.focusBlockEnd(0);
		await editor.pressKey('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		const count = await countEditEvents(editor, async () => {
			await editor.pressBackspace();
			await editor.page.waitForTimeout(200);
		});

		expect(count).toBe(1);
	});

	test('Backspace on cross-block selection spanning list and paragraph emits one edit event', async () => {
		await editor.loadContent('- alpha\n- beta\n\nfollow\n');
		const lastItem = editor.page.locator('[contenteditable="true"]', { hasText: 'beta' });
		await lastItem.click();
		await editor.pressKey('End');
		await editor.pressKey('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		const count = await countEditEvents(editor, async () => {
			await editor.pressBackspace();
			await editor.page.waitForTimeout(200);
		});

		expect(count).toBe(1);
	});
});

// ── Identity preservation (known issue) ───────────────────────────────────

test.describe('cross-block delete — list item id identity', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('surviving list item keeps start-item id after mixed cross-scope delete', async () => {
		await editor.loadContent('- alpha\n- beta\n\nfollow\n');

		const idsBefore: string[] = await editor.page.evaluate(() =>
			(window as any).__test.getListItemIds(0)
		);
		const alphaId = idsBefore[0];
		expect(alphaId).toBeTruthy();

		// Two Shift+ArrowDown creates a mixed-scope selection: start descends
		// into the list, end is the top-level paragraph.
		await editor.focusBlockAtPath([0, 0, 0], 1);
		await editor.pressKey('Shift+ArrowDown');
		await editor.pressKey('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await editor.pressBackspace();
		await editor.page.waitForTimeout(300);

		const idsAfter: string[] = await editor.page.evaluate(() =>
			(window as any).__test.getListItemIds(0)
		);
		expect(idsAfter.length).toBe(1);
		expect(idsAfter[0]).toBe(alphaId);
	});
});

// ── nested paste (paste-dispatch applyStructuralResult) ─────────────────────

test.describe('one edit event per op — nested paste', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('paste multi-block content inside a list item emits exactly one edit event', async () => {
		await editor.loadContent('- Item 1\n- Item 2\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'Item 1' });
		await first.click();
		await editor.pressKey('End');

		await editor.page.evaluate(() => navigator.clipboard.writeText('one\n\ntwo\n'));

		const count = await countEditEvents(editor, async () => {
			await editor.pressKey(`${primaryModifier}+KeyV`);
			await editor.page.waitForTimeout(300);
		});

		expect(count).toBe(1);
	});
});

// ── container-matching paste (paste-dispatch applyContainerMatchingPaste) ───

test.describe('one edit event per op — container-matching paste', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('paste matching list into list with empty target emits exactly one edit event', async () => {
		await editor.loadContent('- alpha\n- beta\n');
		const second = editor.page.locator('[contenteditable="true"]', { hasText: 'beta' });
		await second.click();
		await editor.pressKey('Home');
		await editor.pressKey('Shift+End');

		await editor.page.evaluate(() => navigator.clipboard.writeText('- one\n- two\n'));

		const count = await countEditEvents(editor, async () => {
			await editor.pressKey(`${primaryModifier}+KeyV`);
			await editor.page.waitForTimeout(300);
		});

		expect(count).toBe(1);
	});
});

// ── container-matching merge (paste-dispatch applyContainerMatchingMerge) ──

test.describe('one edit event per op — container-matching merge', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('cross-block paste of matching list over non-empty target emits exactly two edit events', async () => {
		await editor.loadContent('- alpha\n- beta\n');
		const first = editor.page.locator('[contenteditable="true"]', { hasText: 'alpha' });
		await first.click();
		await editor.pressKey('End');
		await editor.pressKey('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		await editor.page.evaluate(() => navigator.clipboard.writeText('- x\n- y\n'));

		const count = await countEditEvents(editor, async () => {
			await editor.pressKey(`${primaryModifier}+KeyV`);
			await editor.page.waitForTimeout(300);
		});

		// cross-block delete + merge-paste each emit one event
		expect(count).toBe(2);
	});
});
