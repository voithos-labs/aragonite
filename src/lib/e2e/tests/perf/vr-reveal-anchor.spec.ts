import { test, expect } from '../../fixtures';
import type { Locator, Page } from '@playwright/test';
import { PluginsPage } from '../plugins/helpers';
import { capturePageErrors } from '../../page-probes';

/**
 * Reveal-anchor ownership (requirements/perf/vr-reveal-anchor.md). Two properties, both
 * cross-cutting and neither reachable from a single-caller spec: the pin names the FULL
 * target path (a nested target is not its container), and a stale claimant cannot release a
 * fresher one's pin. What happens AFTER the settle resolves is this file's subject; the
 * reveal's own composition is covered by `plugins/toc-navigation`.
 */

// Capped viewport → the editor is a real scroll container, so windowing activates
// and the container below is genuinely taller than what can be seen at once.
test.use({ viewport: { width: 1000, height: 700 } });

const LATE_IMAGE_URL = 'https://e2e-deferred.test/late-growth.svg';
const LATE_IMAGE_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1400">' +
	'<rect width="100%" height="100%" fill="#4488cc"/></svg>';

/** Hold the image response until the returned release is called, so its growth
 *  lands as a measure pass AFTER the reveal settles rather than during it. */
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
 * The image sits BELOW the container on purpose: nothing above the viewport moves when it
 * decodes, so the honest top-of-viewport correction is a no-op and any movement at all is
 * the pin re-asserting.
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
	// The blockquote is block 8; its heading is the last of its 27 children.
	return { md: parts.join('\n\n') + '\n', targetPath: [8, 26] };
}

/**
 * The image sits ABOVE the target on purpose: `'nearest'` lands the target near the viewport
 * BOTTOM, so when the image decodes the honest anchor holds a paragraph above it and pushes
 * the target off the bottom. Only a held pin re-asserts it.
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

// In-view = the block's box intersects the editor viewport, measured by path and
// independently of `scrollTo`'s own report so the assertion isn't tautological.
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

		// A pin holding only the container's top-level index re-asserts the CONTAINER's top
		// on this measure pass, pushing the resolved target a container-height below the fold.
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

		// Two claimants inside one settle window, issued from a single task because that
		// window is narrower than a Playwright click round trip (the real-gesture path is
		// `plugins/toc-navigation`). The `'center'` reveal is the stale claimant.
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

		// The assertion the race reddens: the undecoded image keeps the document settling
		// past the navigation's resolve, so a released pin loses the target by here.
		expect(await blockInView(page, targetPath)).toBe(true);

		// A second property, and not what the race turns on: the pin outlives the settle,
		// so a decode landing afterwards re-asserts the target instead of shifting it.
		const collapsedHeight = await imageHostHeight(page);
		releaseImage();
		await expect.poll(() => imageHostHeight(page)).toBeGreaterThan(collapsedHeight + 400);
		await editor.waitForResizeObserverFlush();

		expect(await blockInView(page, targetPath)).toBe(true);
		expect(pageErrors).toEqual([]);
	});
});
