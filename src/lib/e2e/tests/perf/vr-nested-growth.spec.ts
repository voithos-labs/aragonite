import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import type { EditorPage } from '../../editor-page';
import { capturePageErrors } from '../../page-probes';
import { spacerCount, topVisibleHostTop, TOP_LEVEL_HOSTS } from './vr-helpers';
import {
	BELOW,
	CONTAINER,
	docWith,
	listOf,
	openNested,
	quoteOf,
	type ScrollMode
} from './vr-nested-fixtures';

// An image decoding inside a container grows the container, and the page is corrected for it
// exactly once: the block you're looking at doesn't move.
// Requirements: e2e/requirements/perf/vr-nested-growth.md.

test.use({ viewport: { width: 1000, height: 700 } });

const IMAGE_URL = 'https://e2e-deferred.test/nested-growth.svg';
const LATE_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900">' +
	'<rect width="100%" height="100%" fill="#4488cc"/></svg>';
const IMAGE = `![late](${IMAGE_URL})`;

/** Holds the image until the returned call, so it grows after the page has settled. */
async function deferImage(page: Page): Promise<() => void> {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route('https://e2e-deferred.test/**', async (route) => {
		await gate;
		await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: LATE_SVG });
	});
	return release;
}

function imageState(page: Page): Promise<'undecoded' | 'decoded' | 'gone'> {
	return page.evaluate(() => {
		const img = document.querySelector('[data-image-widget] img') as HTMLImageElement | null;
		if (!img) return 'gone';
		return img.complete && img.naturalWidth > 0 ? 'decoded' : 'undecoded';
	});
}

/** Releases the image and waits for it to decode, or for an over-correction to unmount it, so
 *  either way the check that follows is an assertion rather than a timeout. */
async function releaseAndSettle(editor: EditorPage, release: () => void): Promise<void> {
	release();
	await expect.poll(() => imageState(editor.page)).not.toBe('undecoded');
	for (let i = 0; i < 3; i++) {
		await editor.waitForResizeObserverFlush();
		await editor.waitForRenderFlush();
	}
}

test.describe('growth inside a container wholly above the viewport is corrected once', () => {
	const CASES = [
		{ name: "the last item's last block", doc: docWith(listOf(5, 4, IMAGE)) },
		{
			name: 'a middle item, with a block after the image',
			doc: docWith(listOf(5, 2, `${IMAGE}\n\n  a block after the image`))
		}
	];
	for (const { name, doc } of CASES) {
		test(`an image decoding in ${name}`, async ({ page }) => {
			const pageErrors = capturePageErrors(page);
			const release = await deferImage(page);
			const nested = await openNested(page, 'self', doc);
			expect(await spacerCount(page), 'the fixture must window').toBeGreaterThan(0);
			await nested.topInside([CONTAINER]);
			const box = (await nested.contentBox([CONTAINER]))!;
			await nested.scrollTo(Math.round(box.bottom + 80));
			await nested.editor.waitForResizeObserverFlush();

			const pre = await page.evaluate((index) => {
				const editorTop = (document.querySelector('.editor') as HTMLElement).getBoundingClientRect()
					.top;
				const list = document.querySelector(`[data-block-path='[${index}]']`);
				return !!list && list.getBoundingClientRect().bottom < editorTop;
			}, CONTAINER);
			expect(pre, 'the list sits above the viewport').toBe(true);
			expect(await imageState(page)).toBe('undecoded');
			const reference = await topVisibleHostTop(page, { selector: `.editor ${TOP_LEVEL_HOSTS}` });
			const path = JSON.parse(reference!.ref!) as number[];
			const before = (await nested.screenTop(path))!;

			await releaseAndSettle(nested.editor, release);

			const after = await nested.screenTop(path);
			expect(after, `${reference!.ref} stays mounted`).not.toBeNull();
			expect(Math.abs(after! - before), `moved from ${before} to ${after}`).toBeLessThanOrEqual(1);
			expect(pageErrors).toEqual([]);
		});
	}
});

test.describe('growth inside a container holding the viewport’s top is corrected once', () => {
	// The image is child 1 and the viewport's top sits inside child 6, so the growth is above the
	// top and inside the same container; the caret, when there is one, is in root block 32 below it.
	const CASES = [
		{ name: 'a 10-item list, the caret below it', kind: 'list', count: 10, caret: true },
		{ name: 'a 10-item list, no caret', kind: 'list', count: 10, caret: false },
		{ name: 'a 40-item list, no caret', kind: 'list', count: 40, caret: false },
		{
			name: 'a 10-paragraph blockquote, the caret below it',
			kind: 'quote',
			count: 10,
			caret: true
		},
		{ name: 'a 10-paragraph blockquote, no caret', kind: 'quote', count: 10, caret: false },
		{ name: 'a 40-paragraph blockquote, no caret', kind: 'quote', count: 40, caret: false },
		{
			name: 'a 10-item list inside a blockquote, no caret',
			kind: 'quotedList',
			count: 10,
			caret: false
		}
	] as const;
	const containerOf = (kind: string, count: number) =>
		kind === 'list'
			? listOf(count, 1, IMAGE)
			: kind === 'quote'
				? quoteOf(count, IMAGE)
				: listOf(count, 1, IMAGE)
						.split('\n')
						.map((line) => `> ${line}`)
						.join('\n');
	// A list item renders no block host, so its first block stands for it.
	const sixthOf = (kind: string) =>
		kind === 'list' ? [CONTAINER, 6, 0] : kind === 'quote' ? [CONTAINER, 6] : [CONTAINER, 0, 6, 0];

	for (const mode of ['self', 'host'] as ScrollMode[]) {
		for (const { name, kind, count, caret } of CASES) {
			test(`an image decoding in ${name}, scrollMode ${mode}`, async ({ page }) => {
				const pageErrors = capturePageErrors(page);
				const release = await deferImage(page);
				const nested = await openNested(page, mode, docWith(containerOf(kind, count)));
				expect(await spacerCount(page), 'the fixture must window').toBeGreaterThan(0);
				const sixth = sixthOf(kind);
				await nested.topInside(sixth);
				if (caret) {
					await nested.editor.clickBlockAtPath([BELOW], 3);
					await nested.editor.waitForResizeObserverFlush();
				}
				expect(await imageState(page)).toBe('undecoded');
				const reference = caret || count === 10 ? [BELOW] : sixth;
				const before = (await nested.screenTop(reference))!;
				const writes = await nested.countWrites();

				await releaseAndSettle(nested.editor, release);

				const after = await nested.screenTop(reference);
				expect(after, `${JSON.stringify(reference)} stays mounted`).not.toBeNull();
				expect(Math.abs(after! - before), `moved from ${before} to ${after}`).toBeLessThanOrEqual(
					1
				);
				expect(await writes(), 'one scroll write').toHaveLength(1);
				expect(pageErrors).toEqual([]);
			});
		}
	}
});
