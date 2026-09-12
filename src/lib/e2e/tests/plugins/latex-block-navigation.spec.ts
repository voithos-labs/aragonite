import { test, expect } from '../../fixtures';
import { BlockMathPage } from './latex-reveal-helpers';

// The caret's every door into and out of a `$$` block, in the mode that paints its fence lines
// and the one that hides them. Requirements: e2e/requirements/plugins/latex-block-navigation.md.

const BODY = '\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}';
const SOURCE = `$$\n${BODY}\n$$`;

class MathNavPage extends BlockMathPage {
	async landedIn(): Promise<number | undefined> {
		return (await this.bridge.getSelectionPaths())?.anchor.path[0];
	}

	/** Raw offset of the caret inside the math block, or null elsewhere. */
	async caretOffset(): Promise<number | null> {
		const paths = await this.bridge.getSelectionPaths();
		return paths && paths.anchor.path[0] === 1 ? paths.anchor.offset : null;
	}
}

for (const mode of ['live', 'source'] as const) {
	test.describe(`block math navigation (${mode})`, () => {
		let editor: MathNavPage;
		// The first landable offset: live hides the opener line, source paints it.
		const bodyStart = mode === 'live' ? 3 : 0;
		const bodyEnd = mode === 'live' ? 3 + BODY.length : SOURCE.length;

		test.beforeEach(async ({ page }) => {
			editor = new MathNavPage(page);
			await editor.gotoMathSeed('mathblock-multiline');
			await editor.setPresentationMode(mode);
		});

		test('ArrowRight from above reveals at the first landable byte, and ArrowLeft leaves', async ({
			page
		}) => {
			await editor.getBlock(0).click();
			await page.keyboard.press('End');
			await page.keyboard.press('ArrowRight');
			await expect(editor.source).toBeFocused();
			expect(await editor.caretOffset()).toBe(bodyStart);

			await page.keyboard.press('ArrowLeft');
			await expect(editor.source).toHaveCount(0);
			expect(await editor.landedIn()).toBe(0);
		});

		test('ArrowLeft from below reveals at the last landable byte, and ArrowRight leaves', async ({
			page
		}) => {
			await editor.getBlock(2).click();
			await page.keyboard.press('Home');
			await page.keyboard.press('ArrowLeft');
			await expect(editor.source).toBeFocused();
			expect(await editor.caretOffset()).toBe(bodyEnd);

			await page.keyboard.press('ArrowRight');
			await expect(editor.source).toHaveCount(0);
			expect(await editor.landedIn()).toBe(2);
		});
	});
}

// Live only: source mode paints the fence lines, and the sticky entry from above lands on the
// second line there rather than the `$$` line, so its count is a column question, not this one.
test.describe('block math navigation (live) — the vertical walk', () => {
	let editor: MathNavPage;

	test.beforeEach(async ({ page }) => {
		editor = new MathNavPage(page);
		await editor.gotoMathSeed('mathblock-multiline');
		await editor.setPresentationMode('live');
	});

	test('ArrowDown walks the four body lines then leaves below; ArrowUp mirrors it', async ({
		page
	}) => {
		await editor.getBlock(0).click();
		await page.keyboard.press('ArrowDown');
		await expect(editor.source).toBeFocused();
		for (let i = 1; i < 4; i++) {
			await page.keyboard.press('ArrowDown');
			expect(await editor.landedIn()).toBe(1);
		}
		await page.keyboard.press('ArrowDown');
		await expect(editor.source).toHaveCount(0);
		expect(await editor.landedIn()).toBe(2);

		await page.keyboard.press('ArrowUp');
		await expect(editor.source).toBeFocused();
		for (let i = 1; i < 4; i++) {
			await page.keyboard.press('ArrowUp');
			expect(await editor.landedIn()).toBe(1);
		}
		await page.keyboard.press('ArrowUp');
		await expect(editor.source).toHaveCount(0);
		expect(await editor.landedIn()).toBe(0);
	});
});

test.describe('block math navigation (live) — an empty block', () => {
	let editor: MathNavPage;

	test.beforeEach(async ({ page }) => {
		editor = new MathNavPage(page);
		await editor.gotoMathSeed('mathblock');
		await editor.setPresentationMode('live');
		await editor.loadContent('Before\n\n$$$$\n\nAfter\n');
	});

	// The reveal completes the chrome-only source to a body line the caret can sit on; leaving
	// again commits that completion like any other reveal edit.
	test('arrows pass through from above, leaving the completed block behind', async ({ page }) => {
		await editor.getBlock(0).click();
		await page.keyboard.press('End');
		await page.keyboard.press('ArrowRight');
		await expect(editor.source).toBeFocused();
		expect(await editor.sourceText()).toBe('$$\n\n$$');

		await page.keyboard.press('ArrowRight');
		await expect(editor.source).toHaveCount(0);
		expect(await editor.landedIn()).toBe(2);
		await editor.bridge.waitForSourceEquals('Before\n\n$$\n\n$$\n\nAfter\n');
	});

	test('arrows pass through from below', async ({ page }) => {
		await editor.getBlock(2).click();
		await page.keyboard.press('Home');
		await page.keyboard.press('ArrowLeft');
		await expect(editor.source).toBeFocused();
		expect(await editor.sourceText()).toBe('$$\n\n$$');

		await page.keyboard.press('ArrowLeft');
		await expect(editor.source).toHaveCount(0);
		expect(await editor.landedIn()).toBe(0);
	});
});
