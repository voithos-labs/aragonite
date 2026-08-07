import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Arrival at boundaries the root's own flat slice does not answer: inside a container, and
// at the seam a render window cuts (requirements/selection/gap-caret-arrival-scopes.md).
// Root arrival and the exit keys are gap-caret-arrival.spec.ts.

const TABLE = '| a | b |\n| - | - |\n| c | d |\n';
const FENCE = '```\ncode\n```\n';
const LAST_CELL = 3;
// End of the fence body, the offset whose forward Delete crosses the closer.
const CLOSER_BOUNDARY = 8;

// A nested boundary is addressed in its CONTAINER's index space. A stop computed against
// the root would name a boundary one scope too high, and the discriminator is where the
// NEXT move lands: root [3] if the scope is right, root [1] if it collapsed to the root's.
test.describe('gap caret arrival inside a container', () => {
	// alpha, bravo, blockquote[fence], charlie — the quote's scope end is its boundary 1.
	const NESTED = `alpha\n\nbravo\n\n> \`\`\`\n> code\n> \`\`\`\n\ncharlie\n`;

	test('a scope-end gap is the container’s boundary, not the root’s', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(NESTED);
		expect(await editor.bridge.getBlockKind(2)).toBe('blockquote');

		await editor.focusBlockAtPath([2, 0], CLOSER_BOUNDARY);
		await editor.page.keyboard.press('Delete');

		await editor.bridge.waitForGapCaret({ parentPath: [2], index: 1 });

		await editor.page.keyboard.press('Delete');
		await editor.bridge.waitForGapCaret(null);
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						document.activeElement?.closest('[data-block-path]')?.getAttribute('data-block-path') ??
						null
				)
			)
			.toBe('[3]');
	});
});

// The unit harness cannot see a windowing flush, so the only proof that the gap renders
// inside a live slice is a document long enough to window.
test.describe('gap caret under virtual rendering', () => {
	const filler = (count: number, from: number) =>
		Array.from({ length: count }, (_, i) => `para ${from + i}\n`).join('\n');
	const WINDOWED = `${filler(100, 0)}\n${TABLE}\n${FENCE}\n${filler(100, 100)}`;

	test('a mid-document boundary parks the caret once revealed', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(WINDOWED);
		expect(await editor.bridge.getBlockKind(100)).toBe('table');
		expect(await editor.bridge.getBlockKind(101)).toBe('fencedCode');
		// A CST read passes with windowing off; the mounted-host count is what proves a slice.
		const mountedRootHosts = await page.evaluate(
			() =>
				[...document.querySelectorAll('[data-block-path]')].filter(
					(el) => JSON.parse(el.getAttribute('data-block-path')!).length === 1
				).length
		);
		expect(mountedRootHosts).toBeLessThan(60);

		await page.evaluate(() => (window as any).__test.rects.scrollTo([100], { block: 'center' }));
		await page.locator('[role="cell"]').nth(LAST_CELL).click();
		await editor.page.keyboard.press('ArrowDown');

		await editor.bridge.waitForGapCaret({ parentPath: [], index: 101 });
		await expect
			.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-gap-caret]')))
			.toBe(true);
	});
});
