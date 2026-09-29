import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { capturePageErrors } from '../../page-probes';
import { spacerCount, topVisibleHostTop, TOP_LEVEL_HOSTS, type VisibleHost } from './vr-helpers';

// An image decoding inside a list that sits wholly above the viewport grows the list, and the
// page is corrected for it exactly once: the block at the viewport's top doesn't move.
// Requirements: e2e/requirements/perf/vr-nested-growth.md.

test.use({ viewport: { width: 1000, height: 700 } });

const IMAGE_URL = 'https://e2e-deferred.test/nested-growth.svg';
const LATE_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900">' +
	'<rect width="100%" height="100%" fill="#4488cc"/></svg>';
const LIST_INDEX = 30;
const IMAGE = `![late](${IMAGE_URL})`;

const para = (i: number) => `Paragraph ${i} with enough words in it to fill most of a line.`;

/** Five items of two blocks each, except item `imageItem`, whose blocks after the first are `itemBody`. */
function listWith(imageItem: number, itemBody: string): string {
	return Array.from({ length: 5 }, (_, i) =>
		i === imageItem ? `- item ${i}\n\n  ${itemBody}` : `- item ${i}\n\n  a second block`
	).join('\n');
}

function docWith(list: string): string {
	return [
		...Array.from({ length: LIST_INDEX }, (_, i) => para(i)),
		list,
		...Array.from({ length: 150 }, (_, i) => para(LIST_INDEX + 1 + i))
	].join('\n\n');
}

const CASES = [
	{ name: "the last item's last block", doc: docWith(listWith(4, IMAGE)) },
	{
		name: 'a middle item, with a block after the image',
		doc: docWith(listWith(2, `${IMAGE}\n\n  a block after the image`))
	}
];

/** Holds the image until the returned call, so it grows after the list has settled. */
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

/** The list's box in the scroll content, or null while it is unmounted. */
function listBox(page: Page): Promise<{ top: number; bottom: number } | null> {
	return page.evaluate((index) => {
		const editor = document.querySelector('.editor') as HTMLElement;
		const host = document.querySelector(`[data-block-path='[${index}]']`);
		if (!host) return null;
		const offset = editor.scrollTop - editor.getBoundingClientRect().top;
		const rect = host.getBoundingClientRect();
		return { top: rect.top + offset, bottom: rect.bottom + offset };
	}, LIST_INDEX);
}

async function scrollJustPastList(editor: EditorPage): Promise<void> {
	for (let top = 0; top < 20_000; top += 400) {
		if (await listBox(editor.page)) break;
		await editor.scrollEditorTo(top);
	}
	await editor.waitForResizeObserverFlush();
	const box = await listBox(editor.page);
	if (!box) throw new Error('the list never mounted');
	await editor.scrollEditorTo(Math.round(box.bottom + 80));
	await editor.waitForResizeObserverFlush();
}

const imageHostHeight = (page: Page) =>
	page.evaluate(() => {
		const host = document.querySelector('[data-image-widget]')?.closest('.block-host');
		return host ? host.getBoundingClientRect().height : 0;
	});

function topOf(page: Page, host: VisibleHost): Promise<number | null> {
	return page.evaluate((path) => {
		const el = document.querySelector(`[data-block-path='${path}']`);
		return el ? el.getBoundingClientRect().top : null;
	}, host.ref);
}

test.describe('growth inside a list above the viewport is corrected once', () => {
	for (const { name, doc } of CASES) {
		test(`an image decoding in ${name}`, async ({ page }) => {
			const pageErrors = capturePageErrors(page);
			const editor = new EditorPage(page);
			await editor.goto();
			const releaseImage = await deferImage(page);
			await editor.loadContent(doc);
			expect(await spacerCount(page), 'the fixture must window').toBeGreaterThan(0);
			await scrollJustPastList(editor);

			const pre = await page.evaluate((index) => {
				const editorTop = (document.querySelector('.editor') as HTMLElement).getBoundingClientRect()
					.top;
				const list = document.querySelector(`[data-block-path='[${index}]']`);
				const img = document.querySelector('[data-image-widget] img') as HTMLImageElement | null;
				return {
					aboveViewport: !!list && list.getBoundingClientRect().bottom < editorTop,
					undecoded: !!img && !(img.complete && img.naturalWidth > 0)
				};
			}, LIST_INDEX);
			expect(pre).toEqual({ aboveViewport: true, undecoded: true });

			const reference = await topVisibleHostTop(page, { selector: `.editor ${TOP_LEVEL_HOSTS}` });
			expect(reference).not.toBeNull();
			const heightBefore = await imageHostHeight(page);

			releaseImage();
			await expect.poll(() => imageHostHeight(page)).toBeGreaterThan(heightBefore + 300);
			for (let i = 0; i < 3; i++) {
				await editor.waitForResizeObserverFlush();
				await editor.waitForRenderFlush();
			}

			const after = await topOf(page, reference!);
			expect(after).not.toBeNull();
			expect(Math.abs(after! - reference!.top)).toBeLessThanOrEqual(1);
			expect(pageErrors).toEqual([]);
		});
	}
});
