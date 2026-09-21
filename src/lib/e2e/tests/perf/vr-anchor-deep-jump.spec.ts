import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import {
	buildNonUniformBlockquoteDoc,
	cstBlockCount,
	editorScrollHeight,
	spacerCount
} from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// VR-2, the scroll correction, once for each list that does it. What tells the two apart is the
// scrollTop once it has settled, not a block moving mid-flush: the height table, the spacer and
// the newly mounted blocks all land in one pass before paint, so a block's position reads flat
// by the time the DOM can be read. Removing `correctAnchor`'s `scrollTop += delta` leaves
// scrollTop at exactly the jump target.

// Tall paragraphs full of `<br>`, which the character-count estimate makes about 30 times too
// short, mixed with short ones, so a deep scroll lands in a stretch nothing has measured, which
// is what VR-2 is about.
const NON_UNIFORM_BLOCKS = 1200;
function buildNonUniformDoc(): string {
	return (
		Array.from({ length: NON_UNIFORM_BLOCKS }, (_, i) =>
			i % 4 === 0 ? `line${'<br>line'.repeat(30)}` : `short ${i}`
		).join('\n\n') + '\n'
	);
}

/** Jump to 60% of the estimated height and let that stretch measure itself. */
async function jumpAndSettle(editor: EditorPage): Promise<{ target: number; estimate: number }> {
	const estimate = await editorScrollHeight(editor.page);
	const target = Math.round(estimate * 0.6);
	await editor.scrollEditorTo(target);
	for (let i = 0; i < 5; i++) await editor.waitForRenderFlush();
	return { target, estimate };
}

/** The settled scroll position, plus the first mounted block below the viewport's top. */
function settledView(page: Page, selector: string) {
	return page.evaluate((sel) => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		const top = editorEl.getBoundingClientRect().top;
		const hosts = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
		let topBlockY: number | null = null;
		for (const host of hosts) {
			const rect = host.getBoundingClientRect();
			if (rect.bottom > top + 1) {
				topBlockY = rect.top;
				break;
			}
		}
		return { scrollTop: editorEl.scrollTop, editorTop: top, topBlockY };
	}, selector);
}

test('a deep jump into an unmeasured band holds the viewport via scroll-anchor correction (VR-2)', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent(buildNonUniformDoc());

	// Without windowing there is no spacer to jump into and the test proves nothing.
	expect(await spacerCount(page)).toBeGreaterThan(0);

	const { target, estimate } = await jumpAndSettle(editor);
	const settled = await settledView(page, '[data-block-path]:not([data-block-path*=","])');

	const compensation = settled.scrollTop - target;
	console.log(`VR-2 anchor ${JSON.stringify({ estimate, target, ...settled, compensation })}`);

	// The lower bound sits well above jitter and far below the several thousand pixels of
	// correction a badly underestimated stretch produces; without the correction it reads 0.
	expect(compensation).toBeGreaterThan(500);

	// A sanity check rather than the point: without the correction the content moves while
	// scrollTop does not, so a mounted block still sits at the top edge either way.
	expect(settled.topBlockY).not.toBeNull();
	expect(settled.topBlockY!).toBeLessThan(settled.editorTop + 60);
	expect(pageErrors).toEqual([]);
});

// The same change as the root case, on a different list. What makes the correction
// attributable to the nested one: the document has exactly one top-level block, so the root
// list's anchor is always index 0 and its own correction can never move anything.
test('a deep jump into a giant blockquote holds the viewport via the nested scope anchor correction (VR-2)', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent(buildNonUniformBlockquoteDoc());

	expect(await cstBlockCount(page)).toBe(1);
	expect(await spacerCount(page, '.blockquote-block')).toBeGreaterThan(0);

	const { target, estimate } = await jumpAndSettle(editor);
	// Paths with a comma only, which proves the visible content is the blockquote's own
	// children rather than the container's markers.
	const settled = await settledView(page, '[data-block-path*=","]');

	const compensation = settled.scrollTop - target;
	console.log(
		`VR-2 nested anchor ${JSON.stringify({ estimate, target, ...settled, compensation })}`
	);

	expect(compensation).toBeGreaterThan(500);
	expect(settled.topBlockY).not.toBeNull();
	expect(settled.topBlockY!).toBeLessThan(settled.editorTop + 60);
	expect(pageErrors).toEqual([]);
});
