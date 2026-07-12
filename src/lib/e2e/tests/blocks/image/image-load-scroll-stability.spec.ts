import { test, expect } from '../../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

// A short, fixed viewport makes the editor a real (capped) scroll container so the
// image can be scrolled above the fold; the e2e-blocks project sets no viewport.
test.use({ viewport: { width: 1000, height: 600 } });

// A remote image with no width/height reserves no box until it decodes, then grows
// asynchronously. The editor disables native overflow-anchor, so that growth — when it
// happens above the viewport — slides the visible content unless the editor re-measures
// the block and anchor-corrects the scroll on load. This guards that correction in both
// windowing modes (see requirements/blocks/image/image-load-scroll-stability.md).

// Held until releaseImage() so load timing is deterministic. No |WxH hint in the alt,
// so the <img> gets no dimension attributes and reserves no height before it loads.
const IMAGE_URL = 'https://e2e-deferred.test/image.svg';
const DEFERRED_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">' +
	'<rect width="100%" height="100%" fill="#4488cc"/></svg>';

function paragraphs(prefix: string, n: number): string[] {
	return Array.from(
		{ length: n },
		(_, i) => `${prefix} paragraph ${i} with enough text to fill a line.`
	);
}

// ~65 blocks @ ~40px estimate + a 200px image floor ≈ 2800px < the 4000px watermark, so
// windowing stays INACTIVE (every block mounts) while the doc still scrolls.
const INACTIVE_DOC = [
	'# Inactive windowing',
	...paragraphs('Above', 5),
	`![big](${IMAGE_URL})`,
	...paragraphs('Below', 58),
	'PROBE ANCHOR TAIL'
].join('\n\n');

// ~160 blocks clears the 4000px watermark, so windowing ACTIVATES (off-window blocks
// unmount, spacers appear); the image sits a few blocks down so it can be scrolled into
// the overscan band just above the viewport while staying mounted.
const ACTIVE_DOC = [
	'# Active windowing',
	...paragraphs('Above', 4),
	`![big](${IMAGE_URL})`,
	...paragraphs('Below', 160),
	'PROBE ANCHOR TAIL'
].join('\n\n');

function imageHostHeight(page: Page): Promise<number | null> {
	return page.evaluate(() => {
		const host = document.querySelector('[data-image-widget]')?.closest('.block-host');
		return host ? (host as HTMLElement).getBoundingClientRect().height : null;
	});
}

// Resolve a scrollTop that puts the (still-collapsed) image fully above the viewport.
// Inactive: scroll to the bottom. Active: scroll just past the image so it lands in the
// overscan band above the fold — mounted, but off-screen.
type ScrollTarget = (page: Page) => Promise<number>;

const SCROLL_TO_BOTTOM: ScrollTarget = (page) =>
	page.evaluate(() => (document.querySelector('.editor') as HTMLElement).scrollHeight);

const SCROLL_JUST_PAST_IMAGE: ScrollTarget = (page) =>
	page.evaluate(() => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		const host = document
			.querySelector('[data-image-widget]')!
			.closest('.block-host') as HTMLElement;
		const rect = host.getBoundingClientRect();
		const contentTop = rect.top - editorEl.getBoundingClientRect().top + editorEl.scrollTop;
		return Math.round(contentTop + rect.height + 60); // image 60px above the viewport top
	});

async function expectNoShiftOnImageLoad(
	page: Page,
	doc: string,
	scrollTo: ScrollTarget,
	expectWindowed: boolean
): Promise<void> {
	const pageErrors: string[] = [];
	page.on('pageerror', (e) => pageErrors.push(e.message));

	const editor = new EditorPage(page);
	await editor.goto();

	// Hold the image response so it stays in its pre-decode (zero-height) state until we
	// release it. Installed after goto so the harness-ready wait isn't affected.
	let releaseImage!: () => void;
	const imageGate = new Promise<void>((resolve) => {
		releaseImage = resolve;
	});
	await page.route('https://e2e-deferred.test/**', async (route) => {
		await imageGate;
		await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: DEFERRED_SVG });
	});

	await editor.loadContent(doc);
	await editor.waitForRenderFlush();
	await editor.waitForResizeObserverFlush();

	await editor.scrollEditorTo(await scrollTo(page));

	// Preconditions: the windowing mode is the one under test, the image is mounted and
	// fully above the viewport, and it has NOT loaded — else the test can't observe a shift.
	const pre = await page.evaluate(() => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		const host = document
			.querySelector('[data-image-widget]')
			?.closest('.block-host') as HTMLElement | null;
		const img = document.querySelector('[data-image-widget] img') as HTMLImageElement | null;
		return {
			mounted: !!host && !!img,
			aboveViewport: host
				? host.getBoundingClientRect().bottom < editorEl.getBoundingClientRect().top
				: false,
			complete: !!img && img.complete && img.naturalWidth > 0,
			spacers: document.querySelectorAll('.vr-spacer').length
		};
	});
	expect(pre.mounted).toBe(true);
	expect(pre.aboveViewport).toBe(true);
	expect(pre.complete).toBe(false);
	expect(pre.spacers > 0).toBe(expectWindowed);

	const imageHeightBefore = (await imageHostHeight(page))!;

	// Reference: the block at the top of the viewport. It sits below the image, so the
	// image's growth would push it down unless the scroll compensates.
	const refBefore = await page.evaluate(() => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		const top = editorEl.getBoundingClientRect().top;
		const hosts = Array.from(
			document.querySelectorAll("[data-block-path]:not([data-block-path*=','])")
		) as HTMLElement[];
		for (const host of hosts) {
			const rect = host.getBoundingClientRect();
			if (rect.bottom > top + 1)
				return { path: host.getAttribute('data-block-path'), top: rect.top };
		}
		return null;
	});
	expect(refBefore).not.toBeNull();

	// Let the image decode and grow.
	releaseImage();
	await page.waitForFunction(
		() => {
			const img = document.querySelector('[data-image-widget] img') as HTMLImageElement | null;
			return !!img && img.complete && img.naturalWidth > 0;
		},
		null,
		{ timeout: 5000, polling: 16 }
	);
	await editor.waitForRenderFlush();
	await editor.waitForResizeObserverFlush();
	await editor.waitForRenderFlush();

	// Sanity: the image actually grew — otherwise the stability assertion is vacuous.
	const imageHeightAfter = (await imageHostHeight(page))!;
	expect(imageHeightAfter - imageHeightBefore).toBeGreaterThan(100);

	// The reading position held: the top-of-viewport block did not slide despite the
	// image growing well above it.
	const refTopAfter = await page.evaluate((path) => {
		const host = document.querySelector(`[data-block-path='${path}']`) as HTMLElement | null;
		return host ? host.getBoundingClientRect().top : null;
	}, refBefore!.path);
	expect(refTopAfter).not.toBeNull();
	expect(Math.abs(refTopAfter! - refBefore!.top)).toBeLessThan(8);

	expect(pageErrors).toEqual([]);
}

test('unsized image loading above the viewport does not shift the reading position (windowing inactive)', async ({
	page
}) => {
	await expectNoShiftOnImageLoad(page, INACTIVE_DOC, SCROLL_TO_BOTTOM, false);
});

test('unsized image loading above the viewport does not shift the reading position (windowing active)', async ({
	page
}) => {
	await expectNoShiftOnImageLoad(page, ACTIVE_DOC, SCROLL_JUST_PAST_IMAGE, true);
});
