import { type Locator, type Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { waitForEditorHydrated } from '../../page-probes';
import { repeatedWordInParagraph } from '../../showcase-document';

// The `/` showcase as a CONSUMING page (requirements/plugins/showcase-occurrences.md): the
// library paints `.decoration-overlay` geometry and leaves the color to the host, so the marks
// mount whether or not the host styles them. Every other occurrence spec runs on the plugins
// harness, which styles the class, so only a spec on `/` can see the paint go missing. The
// word is picked off the document's own bytes — the owner rewrites its prose by hand.

const OCCURRENCE = '.decoration-overlay.hl-occurrence';
const target = repeatedWordInParagraph();
const WORD = target?.word ?? '';

/** The alpha of the element's own background: 0 for `rgba(0, 0, 0, 0)` and for `transparent`. */
function backgroundAlpha(overlay: Locator): Promise<number> {
	return overlay.evaluate((el) => {
		const channels = getComputedStyle(el).backgroundColor.match(/[\d.]+/g) ?? [];
		if (channels.length === 4) return Number(channels[3]);
		return channels.length === 3 ? 1 : 0;
	});
}

/**
 * Put the caret inside the word's first occurrence by clicking its own client rect. A
 * character offset counted from the block start would retarget itself the next time the
 * showcase prose is edited.
 */
async function clickWord(page: Page, word: string): Promise<void> {
	// The showcase windows its blocks, so the paragraph holding the word is not in the DOM at
	// all until the page scrolls to it; waiting on a locator for it would hang the full timeout.
	const path = await scrollUntilMounted(page, word);
	expect(path, `no mounted block repeats "${word}"`).not.toBeNull();

	const host = page.locator(`[data-block-path='${path}']`);
	await host.scrollIntoViewIfNeeded();
	// Measured after the scroll, not before: a rect below the viewport aims the click at nothing.
	const point = await host.evaluate((block, wanted: string) => {
		const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const at = (node.textContent ?? '').indexOf(wanted);
			if (at < 0) continue;
			const range = document.createRange();
			range.setStart(node, at);
			range.setEnd(node, at + wanted.length);
			const rect = range.getBoundingClientRect();
			return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
		}
		return null;
	}, word);
	expect(point, `no text node holding "${word}"`).not.toBeNull();
	await page.mouse.click(point!.x, point!.y);

	// A click that missed leaves the caret nowhere, and "no marks painted" then passes for the
	// wrong reason — the whole risk in the off-by-default scenario below.
	await expect
		.poll(() =>
			page.evaluate(
				(wanted: string) =>
					document.activeElement?.closest('.block-host')?.textContent?.includes(wanted) ?? false,
				word
			)
		)
		.toBe(true);
}

/** The block path of the first mounted host repeating `word`, scrolling until one mounts. */
async function scrollUntilMounted(page: Page, word: string): Promise<string | null> {
	const editor = page.locator('.editor');
	for (let step = 0; step < 200; step++) {
		const path = await page.evaluate((wanted: string) => {
			for (const host of document.querySelectorAll('.block-host[data-block-path]')) {
				const text = host.textContent ?? '';
				if (text.indexOf(wanted) !== text.lastIndexOf(wanted)) {
					return host.getAttribute('data-block-path');
				}
			}
			return null;
		}, word);
		if (path !== null) return path;
		const atEnd = await editor.evaluate((el) => {
			const before = el.scrollTop;
			el.scrollTop = before + el.clientHeight * 0.8;
			return el.scrollTop <= before;
		});
		await page.waitForTimeout(60);
		if (atEnd) break;
	}
	return null;
}

async function expectMarksPainted(page: Page): Promise<void> {
	const marks = page.locator(OCCURRENCE);
	await expect.poll(() => marks.count()).toBeGreaterThan(1);
	expect(await backgroundAlpha(marks.first())).toBeGreaterThan(0);
}

test.describe('/ showcase occurrence highlight', () => {
	test.beforeEach(async ({ page }) => {
		test.skip(target === null, 'no paragraph in the demo document repeats a four-letter word');
		await page.goto('/');
		// The route SSRs, and a click landing before hydration reaches no handler.
		await waitForEditorHydrated(page);
	});

	test(`the header toggle is what lights the other "${WORD}"s`, async ({ page }) => {
		// The demo opens with the highlight off — the owner found it distracting on a page
		// people read. The same gesture in both halves is what keeps the zero honest.
		await clickWord(page, WORD);
		await expect(page.locator(OCCURRENCE)).toHaveCount(0);

		// The plugin set is set-once at mount, so the toggle remounts the editor and the scroll
		// resets with it; the click helper finds the paragraph again.
		await page.getByTestId('occurrences-toggle').click();
		await clickWord(page, WORD);
		await expectMarksPainted(page);
	});

	// Live is the other mode the showcase sells itself on. Reading has no caret, so it has no
	// occurrence highlight to paint (decorations/hloccur-memo owns that).
	test('the marks paint the same with the markers hidden', async ({ page }) => {
		await page.getByTestId('occurrences-toggle').click();
		await page.locator('.showcase-mode[data-mode="live"]').click();

		await clickWord(page, WORD);

		await expectMarksPainted(page);
	});
});
