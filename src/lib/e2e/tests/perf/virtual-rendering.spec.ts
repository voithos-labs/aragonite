import { test, expect, type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';

// First suite to ACTIVATE windowing: every fixture here clears the editor's
// height watermark, so only a window of top-level blocks mounts and the
// off-window reveal path runs for real. Honest assertions only — a reveal that
// doesn't land the caret is a VR bug to report, not an assertion to soften.

const FIXTURE_BYTES = 2_000_000;

function cstBlockCount(page: Page): Promise<number> {
	return page.evaluate(() => (window as any).__test.getDocument().children.length);
}

function mountedBlockCount(page: Page): Promise<number> {
	return page.evaluate(() => (window as any).__test.perf.snapshot().mountedBlockCount);
}

function spacerCount(page: Page): Promise<number> {
	return page.evaluate(() => document.querySelectorAll('.vr-spacer').length);
}

function topLevelHostPresent(page: Page, index: number): Promise<boolean> {
	return page.evaluate(
		(i) => !!document.querySelector(`[data-block-path='${JSON.stringify([i])}']`),
		index
	);
}

function mountedTopLevelIndices(page: Page): Promise<number[]> {
	return page.evaluate(() =>
		Array.from(document.querySelectorAll('[data-block-path]:not([data-block-path*=","])')).map(
			(el) => JSON.parse(el.getAttribute('data-block-path')!)[0] as number
		)
	);
}

function capturePageErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	return errors;
}

test('windowing bounds the mounted set on a multi-thousand-block doc', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();

	// The running mounted-block balance is polluted by the showcase mounted
	// before perf was armed. Reset to a known 1-block baseline and settle, THEN
	// enable+reset, so post-load the balance reflects the window (≈ census), not
	// window minus showcase.
	await editor.loadContent('baseline\n');
	await page.evaluate(() => {
		(window as any).__test.perf.enable();
		(window as any).__test.perf.reset();
	});

	const blockCount = await editor.loadLargeFixture('many-small-blocks', FIXTURE_BYTES);

	// `many-small-blocks` is flat (no nested hosts), so the top-level DOM census
	// equals the mounted window and the bound is unambiguous.
	const domMounted = await editor.getDomBlockCount();
	const balance = await mountedBlockCount(page);

	console.log(`VR headline ${JSON.stringify({ blockCount, domMounted, balance })}`);

	expect(blockCount).toBeGreaterThan(2000);
	expect(domMounted).toBeLessThan(60);
	expect(domMounted).toBeLessThan(blockCount / 10);
	// Cross-check the gauge against the live census; they should agree within the
	// 1-block baseline the balance was reset on.
	expect(Math.abs(balance - domMounted)).toBeLessThanOrEqual(2);
	// Heaviest windowed reconcile path — a render-phase throw (e.g. a
	// state_unsafe_mutation) must fail the test, not pass silently green.
	expect(pageErrors).toEqual([]);
});

test('mounted set stays bounded as document size grows (O(viewport), not O(doc))', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();

	// `many-small-blocks` is flat, so the top-level DOM census IS the mounted
	// window — no perf-gauge reset dance needed between loads. Two modest sizes
	// that both clearly activate windowing.
	const cstSmall = await editor.loadLargeFixture('many-small-blocks', 500_000);
	const mountedSmall = await editor.getDomBlockCount();
	const cstBig = await editor.loadLargeFixture('many-small-blocks', 1_500_000);
	const mountedBig = await editor.getDomBlockCount();

	console.log(
		`VR size-independence ${JSON.stringify({ cstSmall, mountedSmall, cstBig, mountedBig })}`
	);

	// The bigger doc must have far more CST blocks — otherwise "size-independent"
	// is vacuous (two similar docs would also mount similarly).
	expect(cstBig).toBeGreaterThan(cstSmall * 2);

	// Both windows are small in absolute terms AND nearly equal: a regression
	// where mounting scaled with doc size (bigger doc → more mounted) fails here.
	expect(mountedSmall).toBeLessThan(60);
	expect(mountedBig).toBeLessThan(60);
	expect(Math.abs(mountedBig - mountedSmall)).toBeLessThanOrEqual(10);

	expect(pageErrors).toEqual([]);
});

test('Ctrl+Shift+End reveals and edits the off-window last block', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('flat-prose', FIXTURE_BYTES);

	const blockCount = await cstBlockCount(page);
	const last = blockCount - 1;

	// Precondition: windowing must be active and the last block off-window, or the
	// marker-at-end assertion would pass without ever hitting reveal.
	expect(await spacerCount(page)).toBeGreaterThan(0);
	expect(await editor.getDomBlockCount()).toBeLessThan(blockCount);
	expect(await topLevelHostPresent(page, last)).toBe(false);

	await editor.focusBlockStart(0);
	await page.keyboard.press('Control+Shift+End');
	await editor.waitForCrossBlock(true);
	await page.keyboard.press('ArrowRight'); // collapse the range to its end
	await editor.typeText('VR_MARKER');
	await editor.bridge.waitForSourceContains('VR_MARKER', 10_000);

	const source = await editor.bridge.getSource();
	expect(source.trimEnd().endsWith('VR_MARKER')).toBe(true);
	expect(pageErrors).toEqual([]);
});

test('undo of an off-window block edit reverts cleanly and restores focus', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('flat-prose', FIXTURE_BYTES);

	await editor.focusBlockStart(0);
	await editor.typeText('ALPHA_MARK');
	await editor.bridge.waitForSourceContains('ALPHA_MARK');
	await editor.waitForUndoBatchFlush();

	// Scroll to the very bottom: the focus pin only keeps block 0 mounted within
	// pinExtensionCap blocks, so a one-viewport scroll wouldn't unmount it. The
	// bottom puts the window's start well past the cap.
	const scrollHeight = await page.evaluate(
		() => (document.querySelector('.editor') as HTMLElement).scrollHeight
	);
	await editor.scrollEditorTo(scrollHeight);
	expect(await topLevelHostPresent(page, 0)).toBe(false);

	// Undo's keydown handler is block-scoped, so a key press needs a focused,
	// mounted block to route to. Scrolling block 0 off-window dropped its focus
	// (the pin blurs past the cap), so focus a block that's actually in the
	// bottom window. Undo itself is editor-global — it targets block 0 regardless
	// of which block holds focus — so the reveal still has to scroll block 0 back.
	const mounted = await mountedTopLevelIndices(page);
	const focusTarget = mounted[Math.floor(mounted.length / 2)];
	expect(focusTarget).toBeGreaterThan(100);
	await editor.focusBlockStart(focusTarget);
	expect(await topLevelHostPresent(page, 0)).toBe(false);

	await editor.undo();
	await editor.bridge.waitForSourceNotContains('ALPHA_MARK', 10_000);
	expect(await editor.bridge.getSource()).not.toContain('ALPHA_MARK');

	// The source reverts synchronously, but revealPath remounts block 0 and
	// places the caret a few ticks later. Wait for (and assert) the remount —
	// the reveal's mounting half — before typing, or BETA_MARK could land before
	// the caret is placed. A reveal that never remounts block 0 fails here.
	await page.waitForFunction(() => !!document.querySelector("[data-block-path='[0]']"), null, {
		timeout: 10_000,
		polling: 16
	});
	expect(await topLevelHostPresent(page, 0)).toBe(true);

	// Stronger reveal assertion: the undo's revealPath should have landed the
	// caret back in block 0, so the next type appears there.
	await editor.typeText('BETA_MARK');
	await editor.bridge.waitForSourceContains('BETA_MARK', 10_000);
	expect(await editor.getBlockText(0)).toContain('BETA_MARK');
	expect(pageErrors).toEqual([]);
});

test('scrolling to a mid offset does not make the top visible block vanish', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadLargeFixture('flat-prose', FIXTURE_BYTES);

	const scrollHeight = await page.evaluate(
		() => (document.querySelector('.editor') as HTMLElement).scrollHeight
	);
	await editor.scrollEditorTo(Math.round(scrollHeight / 2));

	// Identify the top-level block sitting at the top of the viewport and its
	// in-viewport offset.
	const topBlock = await page.evaluate(() => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		const top = editorEl.getBoundingClientRect().top;
		const hosts = Array.from(
			document.querySelectorAll('[data-block-path]:not([data-block-path*=","])')
		) as HTMLElement[];
		for (const host of hosts) {
			const rect = host.getBoundingClientRect();
			if (rect.bottom > top + 1)
				return { path: host.getAttribute('data-block-path'), top: rect.top };
		}
		return null;
	});
	expect(topBlock).not.toBeNull();

	await editor.waitForRenderFlush();

	// The same block must still be present and not have teleported. Phase 2 ships
	// estimate-based spacers, so allow generous drift — the asserted invariant is
	// non-disappearance, not pixel-perfect anchoring.
	const after = await page.evaluate((path) => {
		const host = document.querySelector(`[data-block-path='${path}']`) as HTMLElement | null;
		return host ? host.getBoundingClientRect().top : null;
	}, topBlock!.path);
	expect(after).not.toBeNull();
	expect(Math.abs(after! - topBlock!.top)).toBeLessThan(200);
	expect(pageErrors).toEqual([]);
});

test('a small document renders fully with no windowing', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent('# Hi\n\nWorld.\n');

	expect(await spacerCount(page)).toBe(0);
	expect(await editor.getDomBlockCount()).toBe(await editor.bridge.getBlockCount());
	expect(pageErrors).toEqual([]);
});
