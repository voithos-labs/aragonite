import { test, expect } from '../../fixtures';
import { roundTripStable } from './helpers';
import { BlockMathPage } from './latex-reveal-helpers';

/**
 * GitHub's third math form: a ```math fence parsed as its own `mathFence` kind, not `mathBlock`
 * and not a plain `fencedCode`. It uses the same BlockMath component as `$$…$$`, so these tests
 * cover only what is specific to the fence: the kind itself, a KaTeX render through that shared
 * component, and one open, edit and commit round trip that leaves the fence a `mathFence`. The
 * shared editing mechanics are proven by latex-block.spec.ts. Seed `mathfence`: the fence block
 * sits at index 1.
 */

test.describe('plugin math fence: distinct kind, shared render', () => {
	let editor: BlockMathPage;

	test.beforeEach(async ({ page }) => {
		editor = new BlockMathPage(page);
		await editor.gotoMathSeed('mathfence');
	});

	test('renders the ```math fence through the shared BlockMath component as its own kind', async () => {
		await expect(editor.renderedKatex).toHaveCount(1);
		await expect(editor.source).toHaveCount(0);
		// The fence is its own kind, never rewritten to `$$` and never left as fencedCode.
		expect(await editor.bridge.getBlockKind(1)).toBe('mathFence');
		expect(await editor.bridge.getSource()).toContain('```math\nx^2\n```');
	});

	test('reveal → edit the body → commit re-renders and keeps the fence a mathFence', async ({
		page
	}) => {
		await editor.revealFromBefore();
		// Step from the source's leading edge to the start of the `x^2` body and insert a
		// character there: an edit to the info string would change the kind, a body edit must not.
		const bodyStart = (await editor.sourceText()).indexOf('x^2');
		expect(bodyStart).toBeGreaterThan(0);
		for (let i = 0; i < bodyStart; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.type('a');
		// Blur onto the paragraph below, which commits and re-renders.
		await editor.getBlock(2).click();

		await editor.bridge.waitForSourceContains('```math\nax^2\n```');
		await expect(editor.renderedKatex).toHaveCount(1);
		await expect(editor.source).toHaveCount(0);
		expect(await editor.bridge.getBlockKind(1)).toBe('mathFence');
		expect(await roundTripStable(editor.page)).toBe(true);
	});
});
