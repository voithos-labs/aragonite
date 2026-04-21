/**
 * Regression tests: exactly one edit event per structural op for every
 * site migrated to commitMultiScope in 0.5.5.3. Pre-migration, several of
 * these ops could fire zero or two events depending on the code path taken.
 *
 * Requirements: e2e/requirements/selection/multi-scope-event-count.md
 */
import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Subscribe to edit events, perform the async action, return the count. */
async function countEditEvents(
	editor: EditorPage,
	action: () => Promise<void>
): Promise<number> {
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

	// Pre-fix (before 4c07577) mid-item Enter emitted TWO events: one from the
	// item-content replace and one from the outer-list sibling insert. This test
	// fails on the pre-migration code and passes on the commitMultiScope version.
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

	// The blockquote exit path (Enter on empty trailing paragraph when the
	// blockquote has more than one child) routes through commitMultiScope and
	// must fire exactly one event. A two-child blockquote is the minimal case.
	test('Enter on empty trailing blockquote paragraph emits exactly one edit event', async () => {
		await editor.loadContent('> first\n>\n> \n');
		// The last paragraph inside the blockquote is empty — click into it.
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
		// Click into the last list item and extend selection into the paragraph.
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

	// Known identity-preservation issue in computeScopeDescriptor for mixed
	// cross-scope deletes (start descends into the list, end is at top level).
	// The surviving item at position 0 should carry alpha's original id, but
	// the current computeScopeDescriptor logic assigns it beta's id instead.
	// TODO(follow-up): fix computeScopeDescriptor mixed-scope idMap and remove fixme.
	test.fixme(
		'surviving list item keeps start-item id after mixed cross-scope delete',
		async () => {
			await editor.loadContent('- alpha\n- beta\n\nfollow\n');

			// Record id of the first list item (alpha) before the delete.
			const idsBefore: string[] = await editor.page.evaluate(() =>
				(window as any).__test.getListItemIds(0)
			);
			const alphaId = idsBefore[0];
			expect(alphaId).toBeTruthy();

			// Select from offset 1 inside alpha's paragraph to offset 3 of "follow"
			// (top-level block at index 1). This is a mixed-scope selection: start
			// descends into the list, end is at the top level.
			await editor.focusBlockAtPath([0, 0, 0], 1);
			await editor.pressKey('Shift+ArrowDown');
			await editor.waitForCrossBlock(true);
			await editor.pressBackspace();
			await editor.page.waitForTimeout(300);

			// After delete the list still has one item ("alfollow" or similar).
			const idsAfter: string[] = await editor.page.evaluate(() =>
				(window as any).__test.getListItemIds(0)
			);
			expect(idsAfter.length).toBe(1);
			// The surviving item must keep alpha's id (not beta's).
			expect(idsAfter[0]).toBe(alphaId);
		}
	);
});
