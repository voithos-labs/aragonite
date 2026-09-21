import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';

// An edit must re-render only the blocks whose output can change. The performance counters are
// the only way to see that: extra renders leave no trace in the DOM, since every block ends up
// with the right content either way.

test.describe('block render scoping', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('typing a plain character does not re-render reference-bearing blocks', async ({ page }) => {
		const REF_BLOCKS = 30;
		const refs = Array.from({ length: REF_BLOCKS }, (_, i) => `see [link ${i}][r${i}]`).join(
			'\n\n'
		);
		const defs = Array.from(
			{ length: REF_BLOCKS },
			(_, i) => `[r${i}]: https://example.com/${i}`
		).join('\n');
		// Block 0 is plain prose with no brackets; blocks 1 to 30 each resolve a reference, so
		// they subscribe to the link definitions when they mount.
		await editor.loadContent(`plain target\n\n${refs}\n\n${defs}\n`);
		await page.evaluate(() => {
			(window as any).__test.perf.enable();
			(window as any).__test.perf.reset();
		});

		await editor.focusBlockEnd(0);
		await editor.typeSlowly('x');
		await editor.bridge.waitForSourceContains('plain targetx');
		// The change that would re-render everything happens on the debounced input flush, so
		// wait past the edited block's own recompute before reading.
		await page.waitForFunction(
			() => (window as any).__test.perf.snapshot().inlineComputeCount >= 1,
			null,
			{ timeout: 5_000, polling: 16 }
		);
		await editor.waitForRenderFlush();

		const snapshot = await page.evaluate(() => (window as any).__test.perf.snapshot());
		// One or more proves the counter is working, since the edited block did render;
		// re-rendering the whole document would be about REF_BLOCKS, far above this limit.
		expect(snapshot.blockRenderCount).toBeGreaterThanOrEqual(1);
		expect(snapshot.blockRenderCount).toBeLessThanOrEqual(5);
	});

	test('editing an LRD re-renders only reference-bearing blocks', async ({ page }) => {
		const PROSE_BLOCKS = 30;
		const prose = Array.from({ length: PROSE_BLOCKS }, (_, i) => `plain prose ${i}`).join('\n\n');
		const refs = ['see [a][shared]', 'see [b][shared]', 'see [c][shared]'].join('\n\n');
		// 30 prose blocks with no brackets, then 3 blocks holding references, then the shared
		// link definition in the last block. Only the references resolve through it.
		await editor.loadContent(`${prose}\n\n${refs}\n\n[shared]: https://old.example.com\n`);
		const lrdIndex = PROSE_BLOCKS + 3;
		await page.evaluate(() => {
			(window as any).__test.perf.enable();
			(window as any).__test.perf.reset();
		});

		// Add to the URL: one keystroke that changes what the definition says.
		await editor.focusBlockEnd(lrdIndex);
		await editor.typeSlowly('x');
		await editor.bridge.waitForSourceContains('old.example.comx');
		await page.waitForFunction(
			() => (window as any).__test.perf.snapshot().inlineComputeCount >= 1,
			null,
			{ timeout: 5_000, polling: 16 }
		);
		await editor.waitForRenderFlush();

		const snapshot = await page.evaluate(() => (window as any).__test.perf.snapshot());
		// The three references resolve again and the edited definition re-renders; the 30 prose
		// blocks with no brackets must not. A regression re-renders all of them.
		expect(snapshot.blockRenderCount).toBeGreaterThanOrEqual(1);
		expect(snapshot.blockRenderCount).toBeLessThanOrEqual(8);

		// The extra renders this forbids would still leave correct DOM, so confirm the references
		// really followed the new URL: rendering less must not leave anything stale.
		const refLink = editor.getBlock(PROSE_BLOCKS).locator('a.md-link-content');
		await expect(refLink).toHaveAttribute('href', 'https://old.example.comx');
	});
});
