import { test, expect } from '../fixtures';
import { waitForEditorHydrated } from '../page-probes';
import { repeatedWordInParagraph } from '../showcase-document';

// The `/` showcase at phone width, which is the only place these defects exist: the pinned
// 1280 viewport sees nothing that pans, falls off an edge, or waits on a hover no touch
// device has. Nothing here names a sentence of the demo document, which the owner rewrites
// by hand. Requirements: e2e/requirements/mobile-showcase.md.

const PHONE = { width: 320, height: 640 };

test.use({ viewport: PHONE, hasTouch: true });

test.describe('/ showcase on a phone', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await waitForEditorHydrated(page);
	});

	test('neither the page nor the document pans sideways', async ({ page }) => {
		// Polled, not read once: the demo's widest block animates, so a single sample can
		// miss the frame that pushes the pan.
		await expect
			.poll(() =>
				page.evaluate(() => {
					const root = document.querySelector('.editor') as HTMLElement;
					return {
						pagePan: document.documentElement.scrollWidth - window.innerWidth,
						editorPan: root.scrollWidth - root.clientWidth
					};
				})
			)
			.toEqual({ pagePan: 0, editorPan: 0 });
	});

	test('every presentation mode sits on screen and a tap flips the editor', async ({ page }) => {
		const modes = page.locator('.showcase-mode');
		const offscreen = await modes.evaluateAll(
			(els, width) =>
				els
					.map((el) => ({ mode: el.getAttribute('data-mode'), box: el.getBoundingClientRect() }))
					.filter(({ box }) => box.left < 0 || box.right > width)
					.map(({ mode }) => mode),
			PHONE.width
		);
		expect(offscreen).toEqual([]);

		// `live` is the far end of the group, so it is the one an unwrappable strip loses.
		await page.locator('.showcase-mode[data-mode="live"]').tap();
		await expect(page.locator('.editor')).toHaveAttribute('data-presentation', 'live');
	});

	test('the find bar opens inside the viewport and takes typed text', async ({ page }) => {
		await page.keyboard.press('ControlOrMeta+f');
		const bar = page.locator('.search-bar');
		await expect(bar).toBeVisible();

		const box = (await bar.boundingBox())!;
		expect(box.x, 'the bar hangs off the left edge').toBeGreaterThanOrEqual(0);
		expect(box.x + box.width, 'the bar hangs off the right edge').toBeLessThanOrEqual(PHONE.width);

		// A tap, not the mount's own autofocus: hit-testing the input is the half that failed.
		const word = repeatedWordInParagraph();
		expect(word, 'the demo document holds no repeated word to search for').not.toBeNull();
		await page.locator('.search-input').first().tap();
		await page.keyboard.type(word!.word);
		await expect(page.locator('.search-count')).toContainText(' / ');
	});

	test('the drag grips show without a hover and answer a tap', async ({ page }) => {
		await page.getByTestId('drag-handles-toggle').tap();
		const handle = page.locator('.block-drag-handle').first();

		// Nothing hovers on touch, so a handle the hover rule alone reveals stays transparent.
		await expect.poll(() => handle.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
		// Playwright's hit test is the assertion: a `pointer-events: none` grip never
		// becomes the target under the tap point.
		await handle.locator('.grip').tap();
	});

	test('the controls a thumb has to hit clear 24px', async ({ page }) => {
		// WCAG 2.2 AA (2.5.8), not the 44px HIG figure: the header carries eleven controls, and
		// 44 apiece puts back over the document every row the condensed header just gave it.
		const header = await page
			.locator('.showcase-header button')
			.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
		expect(header.length).toBeGreaterThanOrEqual(9);
		expect(Math.min(...header)).toBeGreaterThanOrEqual(24);

		await page.keyboard.press('ControlOrMeta+f');
		await expect(page.locator('.search-bar')).toBeVisible();
		const buttons = await page.locator('.search-bar button').evaluateAll((els) =>
			els.map((el) => {
				const box = el.getBoundingClientRect();
				return Math.min(box.width, box.height);
			})
		);
		expect(buttons.length).toBeGreaterThan(0);
		expect(Math.min(...buttons)).toBeGreaterThanOrEqual(24);
	});

	test('the header leaves the document three quarters of the screen', async ({ page }) => {
		// A quarter, not a fifth: thumb-sized controls cost two rows back, and a header that
		// cannot be operated is not a saved row.
		const header = (await page.locator('.showcase-header').boundingBox())!;
		expect(header.height).toBeLessThanOrEqual(PHONE.height / 4);
	});
});
