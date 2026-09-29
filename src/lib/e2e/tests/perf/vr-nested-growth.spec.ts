import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { capturePageErrors } from '../../page-probes';
import { spacerCount, topVisibleHostTop, TOP_LEVEL_HOSTS } from './vr-helpers';

// An image decoding inside a container grows the container, and the page is corrected for it
// exactly once: the block you're looking at doesn't move.
// Requirements: e2e/requirements/perf/vr-nested-growth.md.

test.use({ viewport: { width: 1000, height: 700 } });

const IMAGE_URL = 'https://e2e-deferred.test/nested-growth.svg';
const LATE_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900">' +
	'<rect width="100%" height="100%" fill="#4488cc"/></svg>';
const CONTAINER = 30;
const BELOW = 32;
const IMAGE = `![late](${IMAGE_URL})`;

const para = (i: number) => `Paragraph ${i} with enough words in it to fill most of a line.`;

function docWith(container: string): string {
	return [
		...Array.from({ length: CONTAINER }, (_, i) => para(i)),
		container,
		...Array.from({ length: 150 }, (_, i) => para(CONTAINER + 1 + i))
	].join('\n\n');
}

/** A list of `count` items of two blocks each; item `imageItem`'s second block onwards is `body`. */
function listOf(count: number, imageItem: number, body: string): string {
	return Array.from({ length: count }, (_, i) =>
		i === imageItem ? `- item ${i}\n\n  ${body}` : `- item ${i}\n\n  a second block`
	).join('\n');
}

/** A blockquote of `count` paragraphs, the image being paragraph 1. */
function quoteOf(count: number): string {
	return Array.from({ length: count }, (_, i) =>
		i === 1 ? `> ${IMAGE}` : `> Quoted paragraph ${i} with a few words.`
	).join('\n>\n');
}

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

/** A block's box in the scroll content, or null while it is unmounted. */
function contentBox(page: Page, path: number[]): Promise<{ top: number; bottom: number } | null> {
	return page.evaluate((p) => {
		const editor = document.querySelector('.editor') as HTMLElement;
		const host = document.querySelector(`[data-block-path='${JSON.stringify(p)}']`);
		if (!host) return null;
		const offset = editor.scrollTop - editor.getBoundingClientRect().top;
		const rect = host.getBoundingClientRect();
		return { top: rect.top + offset, bottom: rect.bottom + offset };
	}, path);
}

async function scrollUntilMounted(editor: EditorPage, path: number[]): Promise<void> {
	for (let top = 0; top < 20_000; top += 400) {
		if (await contentBox(editor.page, path)) break;
		await editor.scrollEditorTo(top);
	}
	await editor.waitForResizeObserverFlush();
	if (!(await contentBox(editor.page, path))) throw new Error(`${path} never mounted`);
}

function screenTop(page: Page, path: string): Promise<number | null> {
	return page.evaluate((p) => {
		const el = document.querySelector(`[data-block-path='${p}']`);
		return el ? el.getBoundingClientRect().top : null;
	}, path);
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

async function expectHeldAt(page: Page, path: string, top: number): Promise<void> {
	const after = await screenTop(page, path);
	expect(after, `${path} stays mounted`).not.toBeNull();
	expect(Math.abs(after! - top), `${path} moved from ${top} to ${after}`).toBeLessThanOrEqual(1);
}

async function load(page: Page, doc: string): Promise<{ editor: EditorPage; release: () => void }> {
	const editor = new EditorPage(page);
	await editor.goto();
	const release = await deferImage(page);
	await editor.loadContent(doc);
	expect(await spacerCount(page), 'the fixture must window').toBeGreaterThan(0);
	return { editor, release };
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
			const { editor, release } = await load(page, doc);
			await scrollUntilMounted(editor, [CONTAINER]);
			const box = (await contentBox(page, [CONTAINER]))!;
			await editor.scrollEditorTo(Math.round(box.bottom + 80));
			await editor.waitForResizeObserverFlush();

			const pre = await page.evaluate((index) => {
				const editorTop = (document.querySelector('.editor') as HTMLElement).getBoundingClientRect()
					.top;
				const list = document.querySelector(`[data-block-path='[${index}]']`);
				return !!list && list.getBoundingClientRect().bottom < editorTop;
			}, CONTAINER);
			expect(pre, 'the list sits above the viewport').toBe(true);
			expect(await imageState(page)).toBe('undecoded');
			const reference = await topVisibleHostTop(page, { selector: `.editor ${TOP_LEVEL_HOSTS}` });

			await releaseAndSettle(editor, release);

			await expectHeldAt(page, reference!.ref!, reference!.top);
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
		{ name: 'a 40-paragraph blockquote, no caret', kind: 'quote', count: 40, caret: false }
	] as const;
	for (const { name, kind, count, caret } of CASES) {
		test(`an image decoding in ${name}`, async ({ page }) => {
			const pageErrors = capturePageErrors(page);
			const container = kind === 'list' ? listOf(count, 1, IMAGE) : quoteOf(count);
			const { editor, release } = await load(page, docWith(container));
			// A list item renders no block host, so its first block stands for it.
			const sixth = kind === 'list' ? [CONTAINER, 6, 0] : [CONTAINER, 6];
			await scrollUntilMounted(editor, sixth);
			const child = (await contentBox(page, sixth))!;
			await editor.scrollEditorTo(Math.round(child.top + 5));
			await editor.waitForResizeObserverFlush();
			if (caret) {
				await editor.clickBlockAtPath([BELOW], 3);
				await editor.waitForResizeObserverFlush();
			}

			const insideSixth = await page.evaluate((p) => {
				const top = (document.querySelector('.editor') as HTMLElement).getBoundingClientRect().top;
				const rect = document
					.querySelector(`[data-block-path='${JSON.stringify(p)}']`)!
					.getBoundingClientRect();
				return rect.top <= top && rect.bottom > top;
			}, sixth);
			expect(insideSixth, "the viewport's top sits inside child 6").toBe(true);
			expect(await imageState(page)).toBe('undecoded');
			const reference = caret || count === 10 ? `[${BELOW}]` : JSON.stringify(sixth);
			const before = (await screenTop(page, reference))!;

			await releaseAndSettle(editor, release);

			await expectHeldAt(page, reference, before);
			expect(pageErrors).toEqual([]);
		});
	}
});
