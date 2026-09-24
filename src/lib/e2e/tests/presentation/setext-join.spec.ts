import { test, expect } from '../../fixtures';
import {
	enterPresentationMode,
	clickBlockSettled,
	focusOffset,
	focusPath,
	stepTo
} from './helpers';

// Joining into a setext heading: the joined text lands on the title line and the underline stays
// under it, in every mode, since no mode draws the underline. Next to a block that is not prose,
// Delete does what it does at a paragraph's end there: the caret moves in and no byte changes.
// Requirements: e2e/requirements/presentation/setext-join.md.

const DOC = 'Setext\n======\n\nnext\n';
const JOINED = 'Setextnext\n======\n';

const expectSource = (ep: { bridge: { getSource(): Promise<string> } }, expected: string) =>
	expect.poll(() => ep.bridge.getSource(), { timeout: 5000 }).toBe(expected);

for (const mode of ['source', 'live', 'preview-inline'] as const) {
	test.describe(`${mode} mode: joining into a setext heading`, () => {
		test('Delete at the title end joins the next block above the underline', async ({ page }) => {
			const ep = await enterPresentationMode(page, mode, DOC);
			await clickBlockSettled(ep, 0);
			await page.keyboard.press('End');
			await ep.waitForRenderFlush();

			await page.keyboard.press('Delete');
			await expectSource(ep, JOINED);
			expect(await ep.bridge.getBlockKind(0)).toBe('setextHeading');
			expect(await focusPath(ep)).toEqual([0]);
			expect(await focusOffset(ep)).toBe(6);

			await ep.undo();
			await expectSource(ep, DOC);
		});

		test('Backspace at the start of the block below makes the same join', async ({ page }) => {
			const ep = await enterPresentationMode(page, mode, DOC);
			await clickBlockSettled(ep, 1);
			await page.keyboard.press('Home');
			await ep.waitForRenderFlush();

			await page.keyboard.press('Backspace');
			await expectSource(ep, JOINED);
			expect(await ep.bridge.getBlockKind(0)).toBe('setextHeading');
			expect(await focusOffset(ep)).toBe(6);
		});

		test('a range deleted from inside the title into the block below keeps the underline', async ({
			page
		}) => {
			const ep = await enterPresentationMode(page, mode, DOC);
			await clickBlockSettled(ep, 0);
			await page.keyboard.press('Home');
			await stepTo(ep, page, 'ArrowRight', 3);
			await ep.shiftClickBlock([1], 2);
			await ep.waitForRenderFlush();

			await page.keyboard.press('Backspace');
			await expectSource(ep, 'Setxt\n======\n');
			expect(await ep.bridge.getBlockKind(0)).toBe('setextHeading');
		});

		test('ArrowRight at the title end moves into the next block', async ({ page }) => {
			const ep = await enterPresentationMode(page, mode, DOC);
			await clickBlockSettled(ep, 0);
			await page.keyboard.press('End');
			await ep.waitForRenderFlush();

			await page.keyboard.press('ArrowRight');
			await ep.waitForRenderFlush();
			expect(await focusPath(ep)).toEqual([1]);
			expect(await focusOffset(ep)).toBe(0);
		});
	});
}

test.describe('live mode: Delete at a setext heading’s end before a block that is not prose', () => {
	for (const [label, next, landing] of [
		['a list', '- item\n', { path: [1, 0, 0], offset: 0 }],
		['a table', '| a |\n| - |\n| 1 |\n', { path: [1, 0, 0], offset: 0 }],
		['a fenced code block', '```\ncode\n```\n', { path: [1], offset: 4 }]
	] as const) {
		test(`moves the caret into ${label} and changes no byte`, async ({ page }) => {
			const doc = 'Setext\n======\n\n' + next;
			const ep = await enterPresentationMode(page, 'live', doc);
			await clickBlockSettled(ep, 0);
			await page.keyboard.press('End');
			await ep.waitForRenderFlush();

			await page.keyboard.press('Delete');
			await expect.poll(() => focusPath(ep)).toEqual([...landing.path]);
			expect(await focusOffset(ep)).toBe(landing.offset);
			expect(await ep.bridge.getSource()).toBe(doc);
		});
	}
});
