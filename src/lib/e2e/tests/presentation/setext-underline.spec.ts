import { test, expect } from '../../fixtures';
import { enterPresentationMode, focusOffset, focusPath, press } from './helpers';

// A setext heading's underline is drawn as a marker: source mode shows it on its own line, where
// the caret can go to edit it, and live mode hides it, where the title's end is the block's end.
// Requirements: e2e/requirements/presentation/setext-underline.md.

const DOC = 'Plan\n===\n\nnext\n';

test.describe('the underline on screen', () => {
	test('source mode shows it under the title', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'source', DOC);
		expect(await ep.getBlock(0).innerText()).toBe('Plan\n===');
	});

	test('live mode hides it', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		expect(await ep.getBlock(0).innerText()).toBe('Plan');
	});
});

// The block is two lines in source mode, and a click at its middle lands on the second one, so
// what the user types there edits the underline and the heading stops being one.
test('source mode: a click at the block middle lands on the underline line', async ({ page }) => {
	const ep = await enterPresentationMode(page, 'source', 'Plan\n---\n');
	await ep.clickBlock(0);
	await ep.waitForRenderFlush();
	expect(await focusPath(ep)).toEqual([0]);
	expect(await focusOffset(ep)).toBeGreaterThan(4);

	await page.keyboard.press('End');
	await ep.typeSlowly('s');
	await ep.bridge.waitForSourceEquals('Plan\n---s\n');
	expect(await ep.bridge.getBlockKind(0)).toBe('paragraph');
});

test.describe('moving the caret across the underline', () => {
	test('source mode: ArrowDown from the title stops on the underline, then leaves', async ({
		page
	}) => {
		const ep = await enterPresentationMode(page, 'source', DOC);
		await ep.focusBlockAtPath([0], 2);

		await press(ep, page, 'ArrowDown');
		expect(await focusPath(ep)).toEqual([0]);
		expect(await focusOffset(ep)).toBeGreaterThan(4);

		await press(ep, page, 'ArrowDown');
		expect(await focusPath(ep)).toEqual([1]);
	});

	test('live mode: ArrowDown from the title leaves the heading', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		await ep.focusBlockAtPath([0], 2);

		await press(ep, page, 'ArrowDown');
		expect(await focusPath(ep)).toEqual([1]);
	});

	for (const [mode, onUnderline] of [
		['source', true],
		['live', false]
	] as const) {
		test(`${mode} mode: ArrowUp from the block below enters the heading`, async ({ page }) => {
			const ep = await enterPresentationMode(page, mode, DOC);
			await ep.focusBlockAtPath([1], 2);

			const landed = await press(ep, page, 'ArrowUp');
			expect(await focusPath(ep)).toEqual([0]);
			if (onUnderline) expect(landed).toBeGreaterThan(4);
			else expect(landed).toBeLessThanOrEqual(4);
		});
	}
});
