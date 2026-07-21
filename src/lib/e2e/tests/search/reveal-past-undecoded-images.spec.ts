import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { primaryModifier } from '../../platform';
import { capturePageErrors } from '../../page-probes';

const findInput = (page: Page) => page.getByRole('textbox', { name: 'Find' });
const prevButton = (page: Page) => page.getByRole('button', { name: 'Previous match' });

// Is an active-match highlight painted AND within the editor viewport? The #1 bug:
// revealing a far match past undecoded images strands the viewport — the images
// measure ~0, the document shrinks, and the browser clamps the reveal scroll up off
// the target block, so the active match lands off-screen (no visible active overlay).
function activeOverlayInView(page: Page): Promise<{ painted: boolean; inView: boolean }> {
	return page.evaluate(() => {
		const ed = document.querySelector('.editor')!.getBoundingClientRect();
		const overlays = Array.from(
			document.querySelectorAll('.match-overlay-active')
		) as HTMLElement[];
		const visible = overlays.find((o) => {
			const r = o.getBoundingClientRect();
			return r.width > 0 && r.height > 0;
		});
		if (!visible) return { painted: false, inView: false };
		const r = visible.getBoundingClientRect();
		return { painted: true, inView: r.top < ed.bottom && r.bottom > ed.top };
	});
}

test('search Previous to a far match past undecoded images keeps the active highlight in view', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);

	// Hold the showcase's images undecoded for the whole test (deterministic): the
	// picsum requests hang, so the <img>s never decode and keep measuring ~0 — the
	// doc-shrink that clamps the reveal. Set before goto so the mount's requests catch it.
	await page.route('https://picsum.photos/**', () => {});

	const editor = new EditorPage(page);
	await editor.goto(); // default SHOWCASE_CONTENT

	await editor.clickBlock(0);
	await page.keyboard.press(`${primaryModifier}+f`);
	await findInput(page).waitFor({ state: 'visible' });
	await page.keyboard.type('list');
	await expect(page.locator('.search-count')).toHaveText(/1\s*\/\s*11/);
	await editor.waitForRenderFlush();

	// "Previous" wraps to the last match — the deep allowlist paragraph, far below the
	// tables and undecoded images.
	await prevButton(page).click();
	await expect(page.locator('.search-count')).toHaveText(/11\s*\/\s*11/);
	await editor.waitForRenderFlush();

	// Poll the reveal's paint+scroll outcome directly: the active match's block
	// must mount, paint, and stay on-screen (no clamp strand).
	await expect.poll(() => activeOverlayInView(page)).toEqual({ painted: true, inView: true });
	expect(pageErrors).toEqual([]);
});
