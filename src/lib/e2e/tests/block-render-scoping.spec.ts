import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';

// The block render path subscribes to the document-level LRD resolver. The
// counts below assert that an edit re-renders only the blocks whose output can
// change — not every mounted block. Perf instruments are the oracle: a render
// fan-out is invisible in the DOM (every block ends up with correct content
// either way), so block-render count is the only signal that distinguishes a
// scoped render from a whole-document one.

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
		// Block 0 is plain prose with no bracket; blocks 1..30 each resolve a
		// reference, so they subscribe to the LRD resolver on mount.
		await editor.loadContent(`plain target\n\n${refs}\n\n${defs}\n`);
		await page.evaluate(() => {
			(window as any).__test.perf.enable();
			(window as any).__test.perf.reset();
		});

		await editor.focusBlockEnd(0);
		await editor.typeSlowly('x');
		await editor.bridge.waitForSourceContains('plain targetx');
		// The reassignment that would fan the render out rides the debounced
		// input flush (~250ms), signalled by the edited block's inline recompute;
		// wait past it, then let any invalidated render effects settle, before
		// reading.
		await page.waitForFunction(
			() => (window as any).__test.perf.snapshot().inlineComputeCount >= 1,
			null,
			{ timeout: 5_000, polling: 16 }
		);
		await editor.waitForRenderFlush();

		const snapshot = await page.evaluate(() => (window as any).__test.perf.snapshot());
		// >= 1 proves the instrument armed (the edited block did render); a whole-
		// document fan-out would be ~REF_BLOCKS, far above this bound.
		expect(snapshot.blockRenderCount).toBeGreaterThanOrEqual(1);
		expect(snapshot.blockRenderCount).toBeLessThanOrEqual(5);
	});

	test('editing an LRD re-renders only reference-bearing blocks', async ({ page }) => {
		const PROSE_BLOCKS = 30;
		const prose = Array.from({ length: PROSE_BLOCKS }, (_, i) => `plain prose ${i}`).join('\n\n');
		const refs = ['see [a][shared]', 'see [b][shared]', 'see [c][shared]'].join('\n\n');
		// 30 bracketless prose blocks, then 3 reference blocks, then the shared
		// LRD (the last block). Only the references resolve through it.
		await editor.loadContent(`${prose}\n\n${refs}\n\n[shared]: https://old.example.com\n`);
		const lrdIndex = PROSE_BLOCKS + 3;
		await page.evaluate(() => {
			(window as any).__test.perf.enable();
			(window as any).__test.perf.reset();
		});

		// Append to the URL — one keystroke that changes the LRD signature.
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
		// The 3 references re-resolve and the edited LRD re-renders; the 30
		// bracketless prose blocks must not. A regression re-renders all of them.
		expect(snapshot.blockRenderCount).toBeGreaterThanOrEqual(1);
		expect(snapshot.blockRenderCount).toBeLessThanOrEqual(8);

		// The fan-out we forbid would still leave correct DOM, so confirm the
		// references actually tracked the new URL — scoping must not drop freshness.
		const refLink = editor.getBlock(PROSE_BLOCKS).locator('a.md-link-content');
		await expect(refLink).toHaveAttribute('href', 'https://old.example.comx');
	});
});
