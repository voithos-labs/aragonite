import { test, expect } from '../../fixtures';
import { PluginsPage, roundTripStable } from './helpers';

/**
 * GitHub's third math form: a ```math fence parsed as the distinct `mathFence` kind,
 * not `mathBlock` and not a plain `fencedCode`. It rides the same render-primary
 * BlockMath component as `$$…$$`, so this pins only what is specific to the fence — the
 * kind identity, a KaTeX render through the shared component, and one reveal→edit→commit
 * round trip that keeps the fence a `mathFence` (the shared editable-leaf mechanics are
 * proven by latex-block.spec.ts). Seed `mathfence`: `Before` / ```math / x^2 / ``` /
 * `After` — the fence block sits at index 1.
 */

class MathFencePage extends PluginsPage {
	get render() {
		return this.page.locator('.math-block-render');
	}

	get source() {
		return this.page.locator('.math-block-source');
	}

	get renderedKatex() {
		return this.page.locator('.math-block-render .katex');
	}

	async sourceText(): Promise<string> {
		return (await this.source.textContent()) ?? '';
	}

	/** Enter the fence from the paragraph above via a real ArrowRight, landing the caret
	 *  at source offset 0 (no click mouseup competing for the caret). */
	async revealFromBefore(): Promise<void> {
		await this.getBlock(0).click();
		await this.page.keyboard.press('End');
		await this.page.keyboard.press('ArrowRight');
		await expect(this.source).toHaveCount(1);
		await this.waitForRenderFlush();
	}
}

test.describe('plugin math fence: distinct kind, shared render', () => {
	let editor: MathFencePage;

	test.beforeEach(async ({ page }) => {
		editor = new MathFencePage(page);
		await editor.gotoPlugins('mathfence');
		await expect(editor.render).toHaveCount(1);
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
		// Walk from the source leading edge to the start of the `x^2` body, then insert a
		// char there — an info-string edit would flip the kind, a body edit must not.
		const bodyStart = (await editor.sourceText()).indexOf('x^2');
		expect(bodyStart).toBeGreaterThan(0);
		for (let i = 0; i < bodyStart; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.type('a');
		// Blur onto the paragraph below → commit + re-render.
		await editor.getBlock(2).click();

		await editor.bridge.waitForSourceContains('```math\nax^2\n```');
		await expect(editor.renderedKatex).toHaveCount(1);
		await expect(editor.source).toHaveCount(0);
		expect(await editor.bridge.getBlockKind(1)).toBe('mathFence');
		expect(await roundTripStable(editor.page)).toBe(true);
	});
});
