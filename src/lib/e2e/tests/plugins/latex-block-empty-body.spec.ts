import { test, expect } from '../../fixtures';
import { roundTripStable } from './helpers';
import { BlockMathPage } from './latex-reveal-helpers';

// A one-line `$$x^2$$` emptied has no body line left, and a surface holding only its hidden fence
// lines is what live mode paints as `$$$$`. The completion has to survive the edit door, not only
// the reveal one. Requirements: e2e/requirements/plugins/latex-block-empty-body.md.

const EMPTIED = '$$\n\n$$';

test.describe('one-line block math emptied (live)', () => {
	let editor: BlockMathPage;

	test.beforeEach(async ({ page }) => {
		editor = new BlockMathPage(page);
		await editor.gotoMathSeed('mathblock');
		await editor.setPresentationMode('live');
		await editor.revealByClick();
	});

	/** The fence pays for itself only while it is hidden: no `$$` on screen, and no chrome-only
	 *  stamp, which is what unhides it. */
	const expectFenceHidden = async () => {
		await expect.poll(() => editor.sourceText()).toBe(EMPTIED);
		await expect(editor.source).not.toHaveAttribute('data-content-empty');
		expect(await editor.getBlock(1).innerText()).not.toContain('$$');
	};

	test('select-all then Backspace leaves an empty body line, not the bare fence', async ({
		page
	}) => {
		await page.keyboard.press('Control+a');
		await page.keyboard.press('Backspace');
		await expectFenceHidden();
	});

	test('emptying the body key by key settles on the same shape', async ({ page }) => {
		await page.keyboard.press('End');
		for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace');
		await expectFenceHidden();
	});

	test('typing into the emptied block resumes the formula', async ({ page }) => {
		await page.keyboard.press('Control+a');
		await page.keyboard.press('Backspace');
		await page.keyboard.type('y');
		await expect.poll(() => editor.sourceText()).toBe('$$\ny\n$$');

		await editor.getBlock(2).click();
		await editor.bridge.waitForSourceEquals('Before\n\n$$\ny\n$$\n\nAfter\n');
	});

	test('the blur after emptying commits the empty body and round-trips', async ({ page }) => {
		await page.keyboard.press('Control+a');
		await page.keyboard.press('Backspace');
		await editor.getBlock(2).click();

		await editor.bridge.waitForSourceEquals(`Before\n\n${EMPTIED}\n\nAfter\n`);
		expect(await editor.bridge.getBlockKind(1)).toBe('mathBlock');
		expect(await roundTripStable(page)).toBe(true);
	});

	// Parity with the built-in fence: an emptied code block takes the next Backspace as "delete
	// the block", since an empty body holds no byte the press could mean.
	test('a second Backspace on the emptied block deletes it', async ({ page }) => {
		await page.keyboard.press('Control+a');
		await page.keyboard.press('Backspace');
		await expectFenceHidden();
		await page.keyboard.press('Backspace');

		await editor.bridge.waitForSourceEquals('Before\n\nAfter\n');
	});
});
