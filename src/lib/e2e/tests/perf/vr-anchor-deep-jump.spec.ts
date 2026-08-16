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

// VR-2 scroll-anchor correction, once per responsible scope. The discriminator is the SETTLED
// scrollTop, not a within-flush block drift: model write, spacer height and slice mount share
// one pre-paint pass, so block-Y reads flat by the time the DOM is observable. Reverting
// `correctAnchor`'s `scrollTop += delta` pins scrollTop at the exact jump target.

// Tall `<br>`-heavy paragraphs the char-based estimator under-models ~30×, interleaved with
// short ones: a deep scroll then lands in an unmeasured band — the VR-2 jump condition.
const NON_UNIFORM_BLOCKS = 1200;
function buildNonUniformDoc(): string {
	return (
		Array.from({ length: NON_UNIFORM_BLOCKS }, (_, i) =>
			i % 4 === 0 ? `line${'<br>line'.repeat(30)}` : `short ${i}`
		).join('\n\n') + '\n'
	);
}

/** Jump to 60% of the estimate-seeded height and let the band measure in. */
async function jumpAndSettle(editor: EditorPage): Promise<{ target: number; estimate: number }> {
	const estimate = await editorScrollHeight(editor.page);
	const target = Math.round(estimate * 0.6);
	await editor.scrollEditorTo(target);
	for (let i = 0; i < 5; i++) await editor.waitForRenderFlush();
	return { target, estimate };
}

/** The settled scroll position plus the first mounted box clearing the viewport top. */
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

	// Without windowing there is no spacer band to jump into and the test is vacuous.
	expect(await spacerCount(page)).toBeGreaterThan(0);

	const { target, estimate } = await jumpAndSettle(editor);
	const settled = await settledView(page, '[data-block-path]:not([data-block-path*=","])');

	const compensation = settled.scrollTop - target;
	console.log(`VR-2 anchor ${JSON.stringify({ estimate, target, ...settled, compensation })}`);

	// The floor sits well above jitter and far below the multi-thousand-px compensation a
	// 30×-under-modeled band produces; the uncorrected build reads exactly 0.
	expect(compensation).toBeGreaterThan(500);

	// Sanity, not the discriminator: without correction the content is displaced while
	// scrollTop is unchanged, so a mounted block still sits at the top edge either way.
	expect(settled.topBlockY).not.toBeNull();
	expect(settled.topBlockY!).toBeLessThan(settled.editorTop + 60);
	expect(pageErrors).toEqual([]);
});

// Same revert as the root arm, disjoint responsible scope. What makes the compensation
// nested-attributable: the doc has exactly ONE top-level block, so the root scope's anchor
// index is always 0 and `offsetOf(0) ≡ 0` makes its correction structurally a no-op.
test('a deep jump into a giant blockquote holds the viewport via the nested scope anchor correction (VR-2)', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent(buildNonUniformBlockquoteDoc());

	expect(await cstBlockCount(page)).toBe(1);
	expect(
		await page.evaluate(() => document.querySelectorAll('.blockquote-block .vr-spacer').length)
	).toBeGreaterThan(0);

	const { target, estimate } = await jumpAndSettle(editor);
	// Comma-path only: proves the visible content is the blockquote's windowed children,
	// not the container chrome.
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
