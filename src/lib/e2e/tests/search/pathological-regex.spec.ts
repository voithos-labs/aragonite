import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { capturePageErrors } from '../../page-probes';
import { count, findInput, openFind, overlays, typeQuery } from './helpers';

/**
 * A regex query that cannot be allowed to freeze the editor
 * (requirements/search/pathological-regex.md). This is the only level that
 * exercises the worker: the unit runner has no `Worker` and falls back to a
 * synchronous scan.
 */

// `(a+)+$` over a run of `a` ending in a non-match backtracks exponentially — this
// length measured in minutes on the main thread before the scan moved off it.
const PATHOLOGICAL_QUERY = '(a+)+$';
const FIXTURE = `ready\n\n${'a'.repeat(32)}!\n`;

// Ceiling for typing the query and landing a keystroke in the document. Well over
// what the off-thread path needs (about a second) and well under what one runaway
// exec costs, so the gap this asserts is an order of magnitude, not a margin.
const MAIN_THREAD_BUDGET_MS = 8000;

test.describe('search — a pathological regex query', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(FIXTURE);
		await openFind(editor);
		await page.getByRole('button', { name: 'Regex' }).click();
		await findInput(page).click(); // the toggle took focus off the input
	});

	test('the editor keeps accepting input while the scan runs', async ({ page }) => {
		// A frozen main thread fails this on ELAPSED TIME, not on a broken assertion:
		// the keystrokes still land eventually, because every one of them — including
		// the query's own last character — simply blocks until the exec returns. So
		// the wall clock is the oracle, and the budget is what separates a scan that
		// left the main thread from one that did not.
		const startedAt = Date.now();

		await typeQuery(editor, PATHOLOGICAL_QUERY);
		await editor.focusBlockEnd(0);
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('readyX', 3000);

		expect(Date.now() - startedAt).toBeLessThan(MAIN_THREAD_BUDGET_MS);
		await expect(findInput(page)).toHaveValue(PATHOLOGICAL_QUERY);
	});

	test('the deadline overrun reports a too-slow state and paints nothing', async ({ page }) => {
		const pageErrors = capturePageErrors(page);
		await typeQuery(editor, PATHOLOGICAL_QUERY);

		await expect(count(page)).toHaveText('Regex too slow', { timeout: 8000 });
		await expect(count(page)).toHaveClass(/error/);
		await expect(overlays(page)).toHaveCount(0);
		// A terminated scan is a state the bar shows, not a rejection that escapes.
		expect(pageErrors).toEqual([]);
	});

	test('a cheap query after an overrun searches again', async ({ page }) => {
		await typeQuery(editor, PATHOLOGICAL_QUERY);
		await expect(count(page)).toHaveText('Regex too slow', { timeout: 8000 });

		await findInput(page).fill('read.');
		await expect(count(page)).toHaveText(/1\s*\/\s*1/);
		await expect(overlays(page)).toHaveCount(1);
	});
});
