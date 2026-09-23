import { test, expect, RESIZE_OBSERVER_LOOP } from '../../fixtures';
import type { Locator, Page } from '@playwright/test';
import { PluginsPage } from '../plugins/helpers';
import { capturePageErrors } from '../../page-probes';

/**
 * Who holds the scroll position after scrolling to a block
 * (requirements/perf/vr-reveal-anchor.md). Two rules, neither reachable from a spec with a
 * single caller: the held position names the full path to the target, so a nested target is not
 * its container, and an older request cannot release a newer one's hold. What happens after the
 * scroll settles is this file's subject; how the scroll itself is put together is covered by
 * `plugins/toc-navigation`.
 */

// A limited viewport makes the editor a real scroll container, so windowing runs and the
// container below is genuinely taller than what fits on screen.
test.use({ viewport: { width: 1000, height: 700 } });

const LATE_IMAGE_URL = 'https://e2e-deferred.test/late-growth.svg';
const LATE_IMAGE_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1400">' +
	'<rect width="100%" height="100%" fill="#4488cc"/></svg>';

/** Hold the image's response until the returned function is called, so it grows in a measure
 *  pass after the scroll has settled rather than during it. */
async function deferImage(page: Page): Promise<() => void> {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route('https://e2e-deferred.test/**', async (route) => {
		await gate;
		await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: LATE_IMAGE_SVG });
	});
	return release;
}

/**
 * The image sits below the container on purpose: nothing above the viewport moves when it
 * decodes, so the ordinary correction does nothing and any movement at all is the held
 * position re-asserting itself.
 */
function tallContainerDoc(): { md: string; targetPath: number[] } {
	const quoted = Array.from(
		{ length: 26 },
		(_, i) => `> Quoted paragraph ${i} with enough words to fill a line.`
	);
	quoted.push('> ## Buried Target');
	const parts = [
		'[[toc]]',
		'# Visible Heading',
		...Array.from(
			{ length: 6 },
			(_, i) => `Intro paragraph ${i} with enough words to fill a line.`
		),
		quoted.join('\n>\n'),
		`![late](${LATE_IMAGE_URL})`,
		...Array.from({ length: 60 }, (_, i) => `Tail paragraph ${i} with enough words to fill a line.`)
	];
	// The blockquote is block 8, and its heading is the last of its 27 children.
	return { md: parts.join('\n\n') + '\n', targetPath: [8, 26] };
}

/**
 * The image sits above the target on purpose: `'nearest'` leaves the target near the bottom of
 * the viewport, so when the image decodes the ordinary correction holds a paragraph above it
 * and pushes the target off the bottom. Only a held position brings it back.
 */
function growthAboveDoc(): { md: string; targetPath: number[] } {
	const parts = [
		'[[toc]]',
		'# Visible Heading',
		...Array.from(
			{ length: 40 },
			(_, i) => `Intro paragraph ${i} with enough words to fill a line.`
		)
	];
	parts.push(`![late](${LATE_IMAGE_URL})`);
	const targetIndex = parts.length;
	parts.push('## Deep Target');
	parts.push(
		...Array.from({ length: 40 }, (_, i) => `Tail paragraph ${i} with enough words to fill a line.`)
	);
	return { md: parts.join('\n\n') + '\n', targetPath: [targetIndex] };
}

class AnchorPage extends PluginsPage {
	entry(label: string): Locator {
		return this.page.locator("[data-block-path='[0]'] .toc-block-item").filter({ hasText: label });
	}
}

// In view means the block's box overlaps the editor's viewport, measured by path and without
// asking `scrollTo` what it thinks, so the check is not circular.
function blockInView(page: Page, path: number[]): Promise<boolean> {
	return page.evaluate((p) => {
		const er = (document.querySelector('.editor') as HTMLElement).getBoundingClientRect();
		const block = document.querySelector(
			`[data-block-path='${JSON.stringify(p)}']`
		) as HTMLElement | null;
		if (!block) return false;
		const br = block.getBoundingClientRect();
		return br.top < er.bottom && br.bottom > er.top;
	}, path);
}

const imageHostHeight = (page: Page) =>
	page.evaluate(() => {
		const host = document.querySelector('[data-image-widget]')?.closest('.block-host');
		return host ? (host as HTMLElement).getBoundingClientRect().height : 0;
	});

test.describe('reveal anchor: the pin names the full target path', () => {
	// A known defect, claimed until fixed (#423): a height correction made inside the block
	// height observer (BlockHost) leaves resize notifications the browser cannot deliver that frame.
	test.use({ expectPageErrors: [RESIZE_OBSERVER_LOOP] });

	test('a nested target survives a measure pass that lands after the reveal settles', async ({
		page
	}) => {
		const pageErrors = capturePageErrors(page);
		const editor = new AnchorPage(page);
		const { md, targetPath } = tallContainerDoc();

		await editor.gotoPlugins('toc');
		const releaseImage = await deferImage(page);
		await editor.loadContent(md);
		await editor.waitForRenderFlush();

		await editor.entry('Buried Target').click();
		await expect.poll(() => blockInView(page, targetPath)).toBe(true);
		await editor.waitForResizeObserverFlush();
		expect(await blockInView(page, targetPath)).toBe(true);

		// A held position that names only the container's top-level index re-asserts the
		// container's top on this pass, pushing the real target a container's height off screen.
		const collapsedHeight = await imageHostHeight(page);
		releaseImage();
		await expect.poll(() => imageHostHeight(page)).toBeGreaterThan(collapsedHeight + 50);
		await editor.waitForResizeObserverFlush();

		expect(await blockInView(page, targetPath)).toBe(true);
		expect(pageErrors).toEqual([]);
	});
});

test.describe('reveal anchor: a stale claimant cannot release a fresher pin', () => {
	test('a center reveal resolving inside a navigation settle strands nothing', async ({ page }) => {
		const pageErrors = capturePageErrors(page);
		const editor = new AnchorPage(page);
		const { md, targetPath } = growthAboveDoc();

		await editor.gotoPlugins('toc');
		const releaseImage = await deferImage(page);
		await editor.loadContent(md);
		await editor.waitForRenderFlush();

		// Two requests inside one settling window, made in a single task because that window is
		// shorter than a Playwright click takes; the version driven by real gestures is
		// `plugins/toc-navigation`. The `'center'` one is the older request.
		await page.evaluate(() => {
			const probe = window as unknown as {
				__test: { rects: { scrollTo(p: number[], o: object): Promise<boolean> } };
			};
			void probe.__test.rects.scrollTo([1], { block: 'center' });
			const entries = Array.from(
				document.querySelectorAll("[data-block-path='[0]'] .toc-block-item")
			) as HTMLElement[];
			entries.find((e) => e.textContent?.includes('Deep Target'))?.click();
		});
		await expect.poll(() => blockInView(page, targetPath)).toBe(true);
		await editor.waitForResizeObserverFlush();

		// What the race breaks: the undecoded image keeps the document settling past the point
		// the navigation returns, so a released hold loses the target by here.
		expect(await blockInView(page, targetPath)).toBe(true);

		// A second rule, not what the race turns on: the hold outlives the settling, so an
		// image decoding afterwards re-asserts the target rather than shifting it.
		const collapsedHeight = await imageHostHeight(page);
		releaseImage();
		await expect.poll(() => imageHostHeight(page)).toBeGreaterThan(collapsedHeight + 400);
		await editor.waitForResizeObserverFlush();

		expect(await blockInView(page, targetPath)).toBe(true);
		expect(pageErrors).toEqual([]);
	});
});
