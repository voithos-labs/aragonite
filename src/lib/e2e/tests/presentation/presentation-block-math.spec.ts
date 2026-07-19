import { test, expect } from '../../fixtures';
import { PluginsPage, roundTripStable } from '../plugins/helpers';

// Render-primary reveal + reading-mode flip on /test/plugins?seed=mathblock. A flip
// while a BlockMath source reveal holds an uncommitted edit commits through the
// blur-class mode effect (mode already reading — commitSource is not reading-gated).
// The header toggle preserves editor focus, so the commit is driven by the flip, not
// a focus-stealing blur. Requirements: e2e/requirements/presentation/presentation-block-math.md.

const RENDER = '.math-block-render';
const SOURCE = '.math-block-source';

test.describe('reading-mode flip commits a render-primary reveal', () => {
	let ep: PluginsPage;

	test.beforeEach(async ({ page }) => {
		ep = new PluginsPage(page);
		await ep.gotoPlugins('mathblock');
		await expect(page.locator(RENDER)).toHaveCount(1);
	});

	// Reveal with a deterministic caret at source offset 0: enter from the paragraph
	// above by keyboard, so no click mouseup competes for the caret.
	async function revealFromBefore() {
		await ep.getBlock(0).click();
		await ep.page.keyboard.press('End');
		await ep.page.keyboard.press('ArrowRight');
		await expect(ep.page.locator(SOURCE)).toHaveCount(1);
		await ep.waitForRenderFlush();
	}

	async function toggleMode() {
		await ep.page.getByTestId('presentation-toggle').click();
	}

	test('an uncommitted reveal edit commits on the flip and the render shows', async ({ page }) => {
		await revealFromBefore();
		// Step two chars past the opening `$$` and insert — `$$ax^2$$`, still revealed
		// (uncommitted): only a blur commits a render-primary leaf.
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type('a');
		expect(await ep.page.locator(SOURCE).textContent()).toContain('$$ax^2$$');

		// Flip to reading with NO intervening click. The blur-class mode effect blurs
		// the still-focused source and commits while the mode is already reading.
		await toggleMode();

		await ep.bridge.waitForSourceContains('$$ax^2$$');
		await expect(ep.editorContainer).toHaveAttribute('data-presentation', 'reading');
		await expect(page.locator(SOURCE)).toHaveCount(0);
		await expect(page.locator(`${RENDER} .katex`)).toHaveCount(1);
		expect(await roundTripStable(page)).toBe(true);
	});

	test('flipping back to source restores editing', async ({ page }) => {
		await revealFromBefore();
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type('a');
		await toggleMode(); // to reading — commits `$$ax^2$$`
		await ep.bridge.waitForSourceContains('$$ax^2$$');

		await toggleMode(); // back to source
		await expect(ep.editorContainer).not.toHaveAttribute('data-presentation');
		// The block reveals and edits again after the round-trip through reading.
		await page.locator(RENDER).click();
		await expect(page.locator(SOURCE)).toHaveCount(1);
		await page.keyboard.press('End');
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.type('b');
		await ep.getBlock(2).click(); // blur onto "After" → commit
		await ep.bridge.waitForSourceContains('$$ax^2b$$');
	});

	test('a no-edit reveal then flip is byte-stable', async ({ page }) => {
		const before = await ep.bridge.getSource();
		await ep.page.locator(RENDER).click();
		await expect(page.locator(SOURCE)).toHaveCount(1);

		await toggleMode(); // flip to reading with the source revealed but unedited
		await expect(page.locator(SOURCE)).toHaveCount(0);
		await expect(page.locator(`${RENDER} .katex`)).toHaveCount(1);
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(before);
	});
});
