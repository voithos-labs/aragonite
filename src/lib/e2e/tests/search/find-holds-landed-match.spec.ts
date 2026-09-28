import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { capturePageErrors } from '../../page-probes';
import { count, findInput } from './helpers';

// A bounded editor, so it scrolls inside its own box and the correction runs.
test.use({ viewport: { width: 1000, height: 700 } });

const LATE_IMAGE_URL = 'https://e2e-deferred.test/late-growth.svg';
const LATE_IMAGE_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900">' +
	'<rect width="100%" height="100%" fill="#4488cc"/></svg>';

const line = (label: string) => `${label} paragraph with enough words to fill a line.`;

// The image sits a few blocks above the match, inside the mounted range but off the top of the
// viewport once the match is scrolled to the middle.
const DOC =
	[
		...Array.from({ length: 30 }, (_, i) => line(`Intro ${i}`)),
		`![late](${LATE_IMAGE_URL})`,
		...Array.from({ length: 12 }, (_, i) => line(`Filler ${i}`)),
		'The zebra paragraph, the only match.',
		...Array.from({ length: 40 }, (_, i) => line(`Tail ${i}`))
	].join('\n\n') + '\n';
const MATCH_INDEX = 43;
const MATCH_TOP_IN_VIEW = 300;

/** Holds the image's response until the returned call, so it grows after the step. */
async function deferImage(page: Page): Promise<() => void> {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	await page.route('https://e2e-deferred.test/**', async (route) => {
		await gate;
		await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: LATE_IMAGE_SVG });
	});
	return release;
}

/** A block's top below the editor's visible top, or null when it isn't mounted. */
function topInView(page: Page, selector: string): Promise<number | null> {
	return page.evaluate((sel) => {
		const editor = (document.querySelector('.editor') as HTMLElement).getBoundingClientRect();
		const el = document.querySelector(sel);
		return el ? el.getBoundingClientRect().top - editor.top : null;
	}, selector);
}

const matchBlock = `[data-block-path='[${MATCH_INDEX}]']`;
const imageHost = '.block-host:has([data-image-widget])';

const imageHeight = (page: Page) =>
	page.evaluate(
		(sel) => document.querySelector(sel)?.getBoundingClientRect().height ?? 0,
		imageHost
	);

test('find next onto a match already on screen keeps it there while an image above it loads', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	const releaseImage = await deferImage(page);
	await editor.loadContent(DOC);
	await editor.waitForRenderFlush();
	await page.evaluate((i) => (window as any).__test.rects.reveal([i]), MATCH_INDEX);
	await editor.waitForRenderFlush();

	const scrollTop = await page.evaluate(
		({ sel, at }) => {
			const scroller = document.querySelector('.editor') as HTMLElement;
			const el = document.querySelector(sel) as HTMLElement;
			const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
			return scroller.scrollTop + top - at;
		},
		{ sel: matchBlock, at: MATCH_TOP_IN_VIEW }
	);
	await editor.scrollEditorTo(scrollTop);
	await editor.waitForResizeObserverFlush();
	// The branch this test is about: the image is mounted, and above the viewport's top.
	expect(await topInView(page, imageHost)).toBeLessThan(0);

	await page.locator(matchBlock).click();
	await page.keyboard.press('ControlOrMeta+f');
	await findInput(page).waitFor({ state: 'visible' });
	await page.keyboard.type('zebra');
	await expect(count(page)).toHaveText(/1\s*\/\s*1/);
	await page.keyboard.press('Enter');
	await editor.waitForRenderFlush();
	await editor.waitForResizeObserverFlush();

	const before = await topInView(page, matchBlock);
	expect(before).not.toBeNull();
	expect(Math.abs(before! - MATCH_TOP_IN_VIEW)).toBeLessThan(40);

	const collapsed = await imageHeight(page);
	releaseImage();
	await expect.poll(() => imageHeight(page)).toBeGreaterThan(collapsed + 50);
	await editor.waitForResizeObserverFlush();

	const after = await topInView(page, matchBlock);
	expect(Math.abs(after! - before!)).toBeLessThanOrEqual(1);
	expect(pageErrors).toEqual([]);
});
