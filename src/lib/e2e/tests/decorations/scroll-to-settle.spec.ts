import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { capturePageErrors } from '../../page-probes';
import { cstBlockCount } from '../perf/vr-helpers';

/**
 * scrollTo must land AND HOLD its target past undecoded images
 * (requirements/decorations/scroll-to-settle.md). The image requests are routed to hang, so
 * they keep measuring ~0 and the doc shrinks — the clamp the reveal anchor exists to survive.
 * The flat-prose rect-api center test has stable heights and cannot reach this class.
 */

// A capped viewport makes the editor a real scroll container so far targets window
// out; short enough that the image band above a mid-doc target fills the activate band.
test.use({ viewport: { width: 1000, height: 700 } });

function scrollTo(
	page: Page,
	path: number[],
	opts?: { block?: 'nearest' | 'center' }
): Promise<boolean> {
	return page.evaluate(
		({ path, opts }) => (window as any).__test.rects.scrollTo(path, opts) as Promise<boolean>,
		{ path, opts }
	);
}

type BlockViewport = {
	mounted: boolean;
	inView: boolean;
	centerOffset: number | null;
	viewportHeight: number;
};

// Test-side geometry, independent of scrollTo's own visibility check, so the pin
// isn't tautological: `inView` = the block box intersects the editor viewport;
// `centerOffset` = signed distance of the block center from the viewport center.
function blockViewport(page: Page, path: number[]): Promise<BlockViewport> {
	return page.evaluate((p) => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		const er = editorEl.getBoundingClientRect();
		const block = document.querySelector(
			`[data-block-path='${JSON.stringify(p)}']`
		) as HTMLElement | null;
		if (!block)
			return { mounted: false, inView: false, centerOffset: null, viewportHeight: er.height };
		const br = block.getBoundingClientRect();
		return {
			mounted: true,
			inView: br.top < er.bottom && br.bottom > er.top,
			centerOffset: br.top + br.height / 2 - (er.top + er.height / 2),
			viewportHeight: er.height
		};
	}, path);
}

test('scrollTo to the document tail past undecoded images lands it in view, not stranded', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);

	// Hold the showcase's picsum images undecoded for the whole test (deterministic):
	// the requests hang, the <img>s never decode and keep measuring ~0. Set before goto.
	await page.route('https://picsum.photos/**', () => {});

	const editor = new EditorPage(page);
	await editor.goto(); // default HARNESS_SHOWCASE_CONTENT — sized/unsized images + wide tables

	const last = (await cstBlockCount(page)) - 1;
	const sel = JSON.stringify([last]);

	// Precondition: the tail is windowed out, or there is nothing to strand.
	await expect(page.locator(`[data-block-path='${sel}']`)).toHaveCount(0);

	const resolved = await scrollTo(page, [last], { block: 'nearest' });
	await editor.waitForRenderFlush();

	// scrollTo's promise resolves only after the post-mount shrink settles, so the target is
	// already at its final position here. Resolving earlier lets the doc shrink under the reveal
	// and the browser clamps it off — stranded and unmounted.
	const view = await blockViewport(page, [last]);
	expect(view.mounted).toBe(true);
	expect(view.inView).toBe(true);
	// The boolean is honest: true correlates with in view.
	expect(resolved).toBe(true);
	expect(pageErrors).toEqual([]);
});

// The dense image band above the target mounts and COLLAPSES on the reveal, the shrink
// that strands a centered target. The `room` prose above it stays windowed out at an
// accurate estimate, so it does not collapse and leaves the ~half viewport `'center'`
// needs; deep prose below keeps the target off max-scrollTop.
function imageBandDoc(): { md: string; targetIndex: number } {
	const parts: string[] = [];
	parts.push('# scrollTo image-band fixture');
	parts.push('Intro prose that establishes the top of the document.');
	for (let i = 0; i < 12; i++) {
		parts.push(`Room paragraph ${i} above the image band, holding centering room.`);
	}
	for (let i = 0; i < 20; i++) {
		parts.push(`![band image ${i}](https://picsum.photos/seed/scrollto-band-${i}/600/400)`);
	}
	const targetIndex = parts.length;
	parts.push('## Target heading below the image band');
	for (let i = 0; i < 90; i++) {
		parts.push(`Below paragraph ${i} with enough words to fill out a full line of prose.`);
	}
	parts.push('End of image-band fixture.');
	return { md: parts.join('\n\n') + '\n', targetIndex };
}

test('scrollTo center to a mid-document target below undecoded images stays centered', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);

	await page.route('https://picsum.photos/**', () => {});

	const editor = new EditorPage(page);
	await editor.goto();

	const { md, targetIndex } = imageBandDoc();
	await editor.loadContent(md);
	await editor.waitForRenderFlush();

	const sel = JSON.stringify([targetIndex]);
	// Precondition: the target is windowed out below the image band.
	await expect(page.locator(`[data-block-path='${sel}']`)).toHaveCount(0);

	const resolved = await scrollTo(page, [targetIndex], { block: 'center' });
	await editor.waitForRenderFlush();

	const view = await blockViewport(page, [targetIndex]);
	expect(view.mounted).toBe(true);
	expect(view.inView).toBe(true);
	// Centered after the band collapses — not clamped to an edge, not stranded above.
	expect(Math.abs(view.centerOffset!)).toBeLessThan(view.viewportHeight * 0.3);
	expect(resolved).toBe(true);
	expect(pageErrors).toEqual([]);
});
