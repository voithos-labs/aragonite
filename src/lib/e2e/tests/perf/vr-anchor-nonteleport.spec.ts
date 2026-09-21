import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { FIXTURE_BYTES, editorScrollHeight, topVisibleHostTop } from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// The block at the top of the viewport must still be there once a mid-document scroll settles,
// in each of the three places windowing runs: the root list, a nested container, and a table's
// rows. A block's position reads flat here by construction, since the spacer, the newly mounted
// blocks and the scroll correction share one pass before paint, so these cases bound how far
// things drift rather than measure the correction, which the deep-jump cases cover.

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

	// A comma in the path means a nested block, the opposite of the filter above.
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

	// Followed by a cell's top, since a `display: contents` row has no box of its own. It is
	// also the check that rows measure correctly: measuring them all too short breaks the
	// bound on drift.
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
