import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { FIXTURE_BYTES, editorScrollHeight, topVisibleHostTop } from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// Non-disappearance of the SETTLED top-of-viewport box after a mid-document scroll, at each
// of the three scopes that window: the root list, a nested container, and a table's rows.
// Block-Y reads flat by construction here (spacer write, slice mount and scrollTop correction
// share one pre-paint pass), so these bound drift rather than measure correction — the
// within-flush correction is the deep-jump suite's subject.

async function hostTopAt(editor: EditorPage, ref: string | null): Promise<number | null> {
	return editor.page.evaluate((path) => {
		const host = document.querySelector(`[data-block-path='${path}']`) as HTMLElement | null;
		return host ? host.getBoundingClientRect().top : null;
	}, ref);
}

async function scrollToMiddle(editor: EditorPage): Promise<void> {
	await editor.scrollEditorTo(Math.round((await editorScrollHeight(editor.page)) / 2));
}

test('scrolling to a mid offset does not make the top visible block vanish', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('flat-prose', FIXTURE_BYTES);

	await scrollToMiddle(editor);

	const topBlock = await topVisibleHostTop(page, {
		selector: '[data-block-path]:not([data-block-path*=","])'
	});
	expect(topBlock).not.toBeNull();

	await editor.waitForRenderFlush();

	const after = await hostTopAt(editor, topBlock!.ref);
	expect(after).not.toBeNull();
	expect(Math.abs(after! - topBlock!.top)).toBeLessThan(200);
	expect(pageErrors).toEqual([]);
});

test('nested: scrolling mid into a giant blockquote does not teleport the top nested block', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('giant-single-blockquote', 2_000_000);

	await scrollToMiddle(editor);

	// A comma in the path means a NESTED host — inverts the top-level filter above.
	const topNested = await topVisibleHostTop(page, { selector: '[data-block-path*=","]' });
	expect(topNested).not.toBeNull();

	await editor.waitForRenderFlush();

	const after = await hostTopAt(editor, topNested!.ref);
	expect(after).not.toBeNull();
	expect(Math.abs(after! - topNested!.top)).toBeLessThan(250);
	expect(pageErrors).toEqual([]);
});

test('scrolling mid into a giant table does not teleport the top visible row', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('giant-single-table', 2_000_000);

	await scrollToMiddle(editor);

	// Tracked via a CELL's top: a display:contents row has no box of its own. Also the check
	// that row heights measure right — a systematic under-measure blows the drift bound.
	const topRow = await topVisibleHostTop(page, {
		selector: '[data-table-row-idx]',
		attr: 'data-table-row-idx',
		cell: true
	});
	expect(topRow).not.toBeNull();

	await editor.waitForRenderFlush();

	const after = await page.evaluate((idx) => {
		const cell = document
			.querySelector(`[data-table-row-idx="${idx}"]`)
			?.querySelector(':scope > .table-cell') as HTMLElement | null;
		return cell ? cell.getBoundingClientRect().top : null;
	}, topRow!.ref);
	expect(after).not.toBeNull();
	expect(Math.abs(after! - topRow!.top)).toBeLessThan(250);
	expect(pageErrors).toEqual([]);
});
