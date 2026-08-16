import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { editorScrollHeight, progressiveScrollTo } from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// Measured heights must survive a structural rebuild. List items and table rows aren't
// BlockHosts, so their measured box reaches the model only through the child-subtotal
// channel; unless that channel persists the box to the oracle by id, a count-changing edit
// reseeds every surviving sibling from estimate and collapses the spacer-backed height.
// Both fixtures are non-uniform on purpose: where estimate already equals measured, the
// reseed is a no-op and the bug is unreachable.

/** Fires only after the CST really grew — windowing mounts a slice, so the DOM count lies. */
async function waitForChildCount(editor: EditorPage, expected: number): Promise<void> {
	await editor.page.waitForFunction(
		(n) => (window as any).__test.getDocument().children[0].children.length === n,
		expected,
		{ timeout: 5000, polling: 16 }
	);
}

function childCount(editor: EditorPage): Promise<number> {
	return editor.page.evaluate(
		() => (window as any).__test.getDocument().children[0].children.length
	);
}

test('structural edit in a windowed non-uniform list keeps the viewport stable', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();

	const md =
		Array.from({ length: 600 }, (_, i) => `- ${'word '.repeat(i % 8 === 0 ? 60 : 4).trim()}`).join(
			'\n'
		) + '\n';
	await editor.loadContent(md);

	expect(
		await page.evaluate(() => document.querySelectorAll('.list-block > .vr-spacer').length)
	).toBeGreaterThan(0);
	const itemCount = await childCount(editor);

	// Progressive, not a direct jump: list items reach the model only while mounted, so
	// measuring them in first is what makes the reseed observable.
	await progressiveScrollTo(editor, Math.round((await editorScrollHeight(page)) / 2));
	await editor.waitForRenderFlush();

	// Edit a host LOWER in the viewport than the reference, so the inserted sibling lands
	// below it and the reference's path stays valid across the edit.
	const inView = await page.evaluate(() => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		const { top, bottom } = editorEl.getBoundingClientRect();
		const visible = (
			Array.from(document.querySelectorAll('[data-block-path*=","]')) as HTMLElement[]
		)
			.map((h) => ({ path: h.getAttribute('data-block-path')!, rect: h.getBoundingClientRect() }))
			.filter((h) => h.rect.bottom > top + 1 && h.rect.top < bottom)
			.map((h) => ({ path: h.path, top: h.rect.top }));
		return { reference: visible[0], editTarget: visible[Math.min(3, visible.length - 1)] };
	});
	expect(inView.reference).toBeTruthy();
	expect(inView.editTarget).toBeTruthy();

	const scrollHeightBefore = await editorScrollHeight(page);

	// Enter at end splits off a new sibling item, which is what triggers the ListBlock rebuild.
	const editPath = JSON.parse(inView.editTarget.path) as number[];
	const editLen = await page.evaluate((p) => {
		const el = document.querySelector(`[data-block-path='${JSON.stringify(p)}']`) as HTMLElement;
		return el?.textContent?.length ?? 0;
	}, editPath);
	await editor.clickBlockAtPath(editPath, editLen);
	await page.keyboard.press('Enter');
	await waitForChildCount(editor, itemCount + 1);
	await editor.waitForRenderFlush();

	// Primary signal: an unfixed rebuild reseeds every above-window item from estimate and
	// collapses the spacer-backed height by thousands of px; one added item moves it by one.
	expect(Math.abs((await editorScrollHeight(page)) - scrollHeightBefore)).toBeLessThan(500);

	// Corroborating signal: the reference host (above the edit) must not teleport.
	const referenceAfter = await page.evaluate((path) => {
		const host = document.querySelector(`[data-block-path='${path}']`) as HTMLElement | null;
		return host ? host.getBoundingClientRect().top : null;
	}, inView.reference.path);
	expect(referenceAfter).not.toBeNull();
	expect(Math.abs(referenceAfter! - inView.reference.top)).toBeLessThan(250);
	expect(pageErrors).toEqual([]);
});

test('structural edit in a windowed non-uniform table keeps the viewport stable', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();

	const header = '| a | b | c |\n| --- | --- | --- |\n';
	const body =
		Array.from({ length: 600 }, (_, i) =>
			i % 8 === 0 ? `| ${'x<br>'.repeat(8)}x | y | z |` : `| p | q | r |`
		).join('\n') + '\n';
	await editor.loadContent(header + body);

	expect(
		await page.evaluate(() => document.querySelectorAll('.table-block > .vr-spacer').length)
	).toBeGreaterThan(0);
	const rowCount = await childCount(editor);

	await progressiveScrollTo(editor, Math.round((await editorScrollHeight(page)) / 2));
	await editor.waitForRenderFlush();

	// Track a CELL: a display:contents row has no box. Edit a row LOWER in the viewport so
	// the inserted sibling lands below the reference and its row-idx stays valid.
	const view = await page.evaluate(() => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		const { top, bottom } = editorEl.getBoundingClientRect();
		const visible = (Array.from(document.querySelectorAll('[data-table-row-idx]')) as HTMLElement[])
			.map((r) => ({
				idx: r.getAttribute('data-table-row-idx')!,
				rect: (
					r.querySelector(':scope > .table-cell') as HTMLElement | null
				)?.getBoundingClientRect()
			}))
			.filter((r) => r.rect && r.rect.bottom > top + 1 && r.rect.top < bottom)
			.map((r) => ({ idx: r.idx, top: r.rect!.top }));
		return { reference: visible[0], editIdx: visible[Math.min(3, visible.length - 1)]?.idx };
	});
	expect(view.reference).toBeTruthy();
	expect(view.editIdx).toBeTruthy();

	const scrollHeightBefore = await editorScrollHeight(page);

	// Ctrl+Enter inserts a row, which is what triggers the TableBlock rebuild.
	await page.locator(`[data-table-row-idx="${view.editIdx}"] [role="cell"]`).first().click();
	await page.keyboard.press('Control+Enter');
	await waitForChildCount(editor, rowCount + 1);
	await editor.waitForRenderFlush();

	// Primary signal: without the oracle-persisting subtotal write the rebuild reseeds every
	// above-window row from estimate, collapsing the height by thousands of px.
	expect(Math.abs((await editorScrollHeight(page)) - scrollHeightBefore)).toBeLessThan(500);

	// Corroborating signal: the reference row (above the edit) must not teleport.
	const referenceAfter = await page.evaluate((idx) => {
		const cell = document
			.querySelector(`[data-table-row-idx="${idx}"]`)
			?.querySelector(':scope > .table-cell') as HTMLElement | null;
		return cell ? cell.getBoundingClientRect().top : null;
	}, view.reference.idx);
	expect(referenceAfter).not.toBeNull();
	expect(Math.abs(referenceAfter! - view.reference.top)).toBeLessThan(250);
	expect(pageErrors).toEqual([]);
});
