import { test, expect } from '../../fixtures';
import { roundTripStable } from './helpers';
import { BlockMathPage } from './latex-reveal-helpers';

// The ```math fence's own fence lines under a marker-hiding mode: lines the mode collapses and the
// edit range is kept away from, exactly as for its `$$` sibling.
// Requirements: e2e/requirements/plugins/latex-fence-live-editing.md.

const SOURCE = '```math\nx^2\n```';

test.describe('math fence editing edges (live)', () => {
	let editor: BlockMathPage;

	test.beforeEach(async ({ page }) => {
		editor = new BlockMathPage(page);
		await editor.gotoMathSeed('mathfence');
		await editor.setPresentationMode('live');
	});

	test('the revealed fence lines keep their bytes and paint nothing', async () => {
		await editor.revealFromBefore();
		expect(await editor.sourceText()).toBe(SOURCE);
		expect(await editor.getBlock(1).innerText()).not.toContain('```');
	});

	test('a delete near the leading edge cannot reach the opener', async ({ page }) => {
		await editor.revealFromBefore();
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Backspace');
		await expect.poll(() => editor.sourceText()).toMatch(/^```math\n/);
	});

	test('select-all then Backspace empties the body alone', async ({ page }) => {
		await editor.revealFromBefore();
		await page.keyboard.press('Control+a');
		await page.keyboard.press('Backspace');
		await expect.poll(() => editor.sourceText()).toBe('```math\n\n```');

		await editor.getBlock(2).click();
		await editor.bridge.waitForSourceEquals('Before\n\n```math\n\n```\n\nAfter\n');
		expect(await editor.bridge.getBlockKind(1)).toBe('mathFence');
		expect(await roundTripStable(page)).toBe(true);
	});

	// Twelve real steps take the range out of the body, past the closing fence line and into the
	// paragraph below. The truncation drops that line, so the block would reopen and swallow the
	// document; its closer comes back instead, as a fenced code block's does.
	test('a range that runs out of the body keeps the closing fence line', async ({ page }) => {
		await editor.revealFromBefore();
		await page.keyboard.press('Home');
		for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+ArrowRight');
		await page.keyboard.press('Backspace');

		await editor.bridge.waitForSourceEquals('Before\n\n```math\nAfter\n```\n');
		expect(await editor.bridge.getBlockKind(1)).toBe('mathFence');
		expect(await roundTripStable(page)).toBe(true);
	});
});
