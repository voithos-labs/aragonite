import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { enterPresentationMode } from '../presentation/helpers';
import { capturePageErrors } from '../../page-probes';
import {
	MAX_UNMOUNTED_EDGE_FRACTION,
	TOP_LEVEL_HOSTS,
	cstBlockCount,
	mountedViewportSpan,
	mountedTopLevelCount,
	spacerCount
} from './vr-helpers';

// Live mode windows like every other rung: its blocks are the heavy ones (highlighted code,
// rendered math), which is the case FOR a bounded mount. Requirements:
// e2e/requirements/perf/vr-live-mode.md.

const SECTIONS = 150;
const CODE = ['function scan(input) {', '\tconst out = [];', '\tfor (const ch of input) {']
	.concat(['\t\tif (ch === "\\n") out.push(ch.charCodeAt(0));', '\t}', '\treturn out;', '}'])
	.join('\n');
const HEAVY = Array.from({ length: SECTIONS }, (_, i) =>
	[
		`## Section ${i}`,
		`Prose ahead of the fence in section ${i}, with **bold** and a [link](https://example.com).`,
		'```js',
		CODE,
		'```',
		`Prose after the fence, ${i} of ${SECTIONS}.`,
		`- item one of ${i}`,
		`- item two of ${i}`
	].join('\n\n')
).join('\n\n');

// The mounted-set ceiling every VR bound shares; the span floor keeps it from being met by
// mounting nothing.
const MOUNTED_CEILING = 60;
const WHEEL_TICKS = 40;
const WHEEL_TICK_PX = 240;

async function editorScrollTop(page: Page): Promise<number> {
	return page.evaluate(() => (document.querySelector('.editor') as HTMLElement).scrollTop);
}

async function expectBoundedWindow(page: Page, blockCount: number, when: string): Promise<void> {
	const mounted = await mountedTopLevelCount(page);
	expect(mounted, `${when}: mounted top-level hosts`).toBeLessThan(MOUNTED_CEILING);
	expect(mounted, `${when}: mounted top-level hosts`).toBeLessThan(blockCount / 10);
	expect(await spacerCount(page), `${when}: spacers`).toBeGreaterThan(0);
	const span = await mountedViewportSpan(page, TOP_LEVEL_HOSTS);
	expect(span.topGapPx, `${when}: top gap`).toBeLessThan(
		span.viewportHeight * MAX_UNMOUNTED_EDGE_FRACTION
	);
	expect(span.bottomGapPx, `${when}: bottom gap`).toBeLessThan(
		span.viewportHeight * MAX_UNMOUNTED_EDGE_FRACTION
	);
}

/** A real wheel gesture over the editor, which scrolls internally; settles on the scroll
 *  having moved and the window having recomputed. */
async function wheelTick(page: Page, editor: EditorPage): Promise<void> {
	const before = await editorScrollTop(page);
	await page.mouse.wheel(0, WHEEL_TICK_PX);
	await expect.poll(() => editorScrollTop(page)).toBeGreaterThan(before);
	await editor.waitForRenderFlush();
}

test('live mode keeps the mounted set bounded while wheel-scrolling a heavy document', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = await enterPresentationMode(page, 'live', HEAVY);
	const blockCount = await cstBlockCount(page);
	expect(blockCount).toBeGreaterThan(SECTIONS * 5);

	await expectBoundedWindow(page, blockCount, 'at load');

	const box = (await editor.editorContainer.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	let peak = 0;
	for (let i = 0; i < WHEEL_TICKS; i++) {
		await wheelTick(page, editor);
		peak = Math.max(peak, await mountedTopLevelCount(page));
	}

	expect(peak, 'peak mounted top-level hosts across the scroll').toBeLessThan(MOUNTED_CEILING);
	await expectBoundedWindow(page, blockCount, 'after the scroll');
	expect(pageErrors).toEqual([]);
});

test('a flip into live keeps the window it entered with', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = await enterPresentationMode(page, 'source', HEAVY);
	const blockCount = await cstBlockCount(page);
	await editor.scrollEditorTo(WHEEL_TICKS * WHEEL_TICK_PX);
	await expectBoundedWindow(page, blockCount, 'in source');

	await page.getByTestId('live-toggle').click();
	await expect(editor.editorContainer).toHaveAttribute('data-presentation', 'live');
	await editor.waitForRenderFlush();

	await expectBoundedWindow(page, blockCount, 'in live');
	expect(pageErrors).toEqual([]);
});
