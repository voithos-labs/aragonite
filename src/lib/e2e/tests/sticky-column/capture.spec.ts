import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

const PIXEL_TOLERANCE = 5;

const TWO_LONG =
	'Hello world this is the first paragraph.\n\nSecond paragraph is also quite long.\n';

test.describe('sticky column: basic capture and cross-block', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	for (const key of ['ArrowDown', 'ArrowUp'] as const) {
		test(`${key} preserves column when moving from long line to long line`, async () => {
			await editor.loadContent(TWO_LONG);

			await editor.page
				.locator('[contenteditable="true"]')
				.nth(key === 'ArrowDown' ? 0 : 1)
				.click();
			await editor.page.keyboard.press('Home');
			for (let i = 0; i < 10; i++) await editor.page.keyboard.press('ArrowRight');

			const sourceX = await editor.getCaretPixelX();
			expect(sourceX).toBeGreaterThan(0);

			await editor.page.keyboard.press(key);
			await editor.waitForRenderFlush();

			const targetX = await editor.getCaretPixelX();
			expect(Math.abs(targetX - sourceX)).toBeLessThan(PIXEL_TOLERANCE);
		});
	}
});

// The column survives however many short blocks the walk clamps through on its way down.
const CLAMPING = [
	{
		name: 'a short block',
		doc: 'A very long first paragraph with plenty of characters to start at a high column.\n\nShort.\n\nAnother long paragraph here with many characters to land in.\n',
		steps: 2
	},
	{
		name: 'multiple short blocks',
		doc: 'Long line one with plenty of text to start at a high column position.\n\nA.\n\nB.\n\nC.\n\nAnother very long line with many characters near the far side.\n',
		steps: 4
	}
];

test.describe('sticky column: survive intermediate clamping', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	for (const { name, doc, steps } of CLAMPING) {
		test(`ArrowDown through ${name} preserves the original column in the final long block`, async () => {
			await editor.loadContent(doc);

			const first = editor.page.locator('[contenteditable="true"]').nth(0);
			await first.click();
			await editor.page.keyboard.press('Home');
			for (let i = 0; i < 40; i++) await editor.page.keyboard.press('ArrowRight');

			const sourceX = await editor.getCaretPixelX();
			expect(sourceX).toBeGreaterThan(100);

			for (let i = 0; i < steps; i++) {
				await editor.page.keyboard.press('ArrowDown');
				await editor.waitForRenderFlush();
			}

			const targetX = await editor.getCaretPixelX();
			expect(Math.abs(targetX - sourceX)).toBeLessThan(PIXEL_TOLERANCE);
		});
	}
});
