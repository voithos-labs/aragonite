import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import {
	buildNonUniformBlockquoteDoc,
	cstBlockCount,
	editorScrollHeight,
	progressiveScrollTo,
	spacerCount,
	topVisibleHostTop
} from './vr-helpers';
import { capturePageErrors } from '../../page-probes';

// Edits and unmounts AWAY from the fold: an above-fold insert shifts every index below it, a
// scrolled-away cell drops out of a column's max-content, and a below-fold reorder relocates
// the block the structural correction would otherwise follow. Each holds the viewport by a
// different mechanism, and each has its own revert.

function scrollTopOf(page: Page): Promise<number> {
	return page.evaluate(() => (document.querySelector('.editor') as HTMLElement).scrollTop);
}

// F4: a numeric anchor measures a DIFFERENT block's offset after the shift and over-corrects
// by ~one block height; the fix remaps by stable id. Block-Y IS the discriminator here
// (unlike the deep-jump suite) because the child set really mutates. Driven programmatically
// at a nested scope: above-fold blocks are unmounted, so there is no clickable target.
test('inserting a block above the fold holds the viewport via anchor remap (F4)', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();

	// Non-uniform on purpose: in a uniform doc the inserted block matches index N's old
	// occupant and the numeric delta comes out accidentally correct.
	await editor.loadContent(buildNonUniformBlockquoteDoc());
	expect(await cstBlockCount(page)).toBe(1);
	expect(await spacerCount(page, '.blockquote-block')).toBeGreaterThan(0);

	// Progressive: the reseed is only observable where measured heights around the anchor
	// diverge from the reseed estimate.
	await progressiveScrollTo(editor, Math.round((await editorScrollHeight(page)) / 2));
	await editor.waitForRenderFlush();

	const topHost = await topVisibleHostTop(page, { selector: '[data-block-path*=","]' });
	expect(topHost).not.toBeNull();
	const before = { childIndex: (JSON.parse(topHost!.ref!) as number[])[1], y: topHost!.top };
	expect(before.childIndex).toBeGreaterThan(5); // the insert is far above the fold

	const childCountBefore = await page.evaluate(
		() => (window as any).__test.getDocument().children[0].children.length
	);

	// Child 0 is well above the viewport, in the unmounted region; `spliceContainerChildren`
	// keeps `childIds` in lockstep so the rebuild fires with a valid id and no scroll move.
	await page.evaluate(() => {
		const tall = `> inserted${'<br>line'.repeat(30)}\n`;
		(window as any).__test.spliceContainerChildren([0], 0, 0, tall);
	});
	expect(
		await page.evaluate(() => (window as any).__test.getDocument().children[0].children.length)
	).toBe(childCountBefore + 1);
	await editor.waitForRenderFlush();

	// The anchor child sits at childIndex+1 after the insert; without the id-remap the
	// numeric correction over-shoots and it jumps by ~one inserted-block height.
	const after = await page.evaluate((childIndex) => {
		const host = document.querySelector(
			`[data-block-path='${JSON.stringify([0, childIndex])}']`
		) as HTMLElement | null;
		return host ? host.getBoundingClientRect().top : null;
	}, before.childIndex + 1);

	const drift = after !== null ? Math.abs(after - before.y) : Infinity;
	console.log(`F4 anchor-remap ${JSON.stringify({ ...before, after, drift })}`);

	expect(after).not.toBeNull();
	// 40px sits below the inserted block's height (the buggy displacement) and above noise.
	expect(drift).toBeLessThan(40);
	expect(pageErrors).toEqual([]);
});

// F6: `minmax(80px, max-content)` sizes a track to its currently-MOUNTED cells, so the column
// reflows mid-scroll once its widest cell unmounts; the fix pins each track to the widest cell
// seen so far (monotonic-grow floor).
test('a column does not shrink when its widest cell scrolls out of the window (F6)', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();

	// Exactly one wide cell, near the top: column 0's max-content is driven entirely by it,
	// so a deep scroll that unmounts its row is what collapses the track.
	const wide = 'wordwordword '.repeat(20).trim();
	const header = '| a | b | c |\n| --- | --- | --- |\n';
	const body = Array.from({ length: 800 }, () => `| p | q | r |`).join('\n') + '\n';
	await editor.loadContent(`${header}| ${wide} | y | z |\n${body}`);

	// Without row windowing the wide cell never unmounts and the test is vacuous.
	expect(await spacerCount(page, '.table-block >')).toBeGreaterThan(0);

	// Any mounted row reports the shared track width; the wide row is in the initial window.
	const firstCellWidth = () =>
		page.evaluate(() => {
			const cell = document.querySelector(
				'[data-table-row-idx] > .table-cell'
			) as HTMLElement | null;
			return cell ? cell.getBoundingClientRect().width : null;
		});
	const widthBefore = await firstCellWidth();
	expect(widthBefore).not.toBeNull();
	// Sanity: the wide cell really did stretch column 0 well past the 80px floor.
	expect(widthBefore!).toBeGreaterThan(200);

	await editor.scrollEditorTo(Math.round((await editorScrollHeight(page)) * 0.9));
	await editor.waitForRenderFlush();

	// If the wide row is still in the DOM the column stays wide for the wrong reason.
	expect(await page.evaluate(() => document.querySelector('[data-table-row-idx="1"]'))).toBeNull();

	const widthAfter = await firstCellWidth();
	console.log(`F6 column-stability ${JSON.stringify({ widthBefore, widthAfter })}`);

	expect(widthAfter).not.toBeNull();
	// 0.9x tolerates sub-pixel jitter while failing hard on the multi-hundred-px collapse
	// toward the 80px floor that an unpinned track produces.
	expect(widthAfter!).toBeGreaterThan(widthBefore! * 0.9);
	expect(pageErrors).toEqual([]);
});

// F7: with no content scrolled above the viewport top (localScrollTop === 0), the list scope's
// `correctAnchorByStableId` would FOLLOW the relocated block and shift the shared scrollTop.
// One Alt+Up + Alt+Down is a structural no-op, so scrollTop must return to baseline.
test('reordering a list item below the fold does not drift scrollTop (F7)', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();

	// Filler both sides so the list can drift either way rather than clamp at a boundary;
	// ALPHA tall and BETA short so the anchor-follow delta is non-zero and asymmetric.
	const pre = Array.from({ length: 60 }, (_, i) => `pre filler ${i}`).join('\n\n');
	const post = Array.from({ length: 60 }, (_, i) => `post filler ${i}`).join('\n\n');
	const tall = `ZALPHAITEM ${'word '.repeat(40)}`.trim();
	await editor.loadContent(`${pre}\n\n1. ${tall}\n2. ZBETAITEM\n\n${post}\n`);

	// Content offset of the first mounted host containing `text`, or null if not mounted.
	const offsetOf = (text: string) =>
		page.evaluate((t) => {
			const ed = document.querySelector('.editor') as HTMLElement;
			const host = [...document.querySelectorAll('[data-block-path]')].find((h) =>
				(h.textContent || '').includes(t)
			);
			if (!host) return null;
			return host.getBoundingClientRect().top - ed.getBoundingClientRect().top + ed.scrollTop;
		}, text);

	// Scroll until the list mounts, then leave its top ~250px below the editor's viewport top,
	// which is what makes the list scope's localScrollTop 0.
	let alphaOffset: number | null = null;
	for (let step = 0; step < 80 && alphaOffset === null; step++) {
		alphaOffset = await offsetOf('ZALPHAITEM');
		if (alphaOffset === null) {
			const top = await page.evaluate(() => {
				const ed = document.querySelector('.editor') as HTMLElement;
				return ed.scrollTop + ed.clientHeight * 0.7;
			});
			await editor.scrollEditorTo(top);
		}
	}
	expect(alphaOffset).not.toBeNull();
	await editor.scrollEditorTo(Math.round(alphaOffset! - 250));

	// Baseline is taken AFTER the click so any click-induced scroll is absorbed into it.
	await page.locator('[contenteditable="true"]', { hasText: 'ZBETAITEM' }).click();
	await editor.waitForRenderFlush();

	const listTopRel = (await offsetOf('ZALPHAITEM'))! - (await scrollTopOf(page));
	// Without this the test cannot reach the buggy branch.
	expect(listTopRel, 'list must sit below the viewport top (localScrollTop===0)').toBeGreaterThan(
		50
	);

	const baseline = await scrollTopOf(page);

	// Ordered markers renumber, so the reorder is observable through the serialized source.
	await page.keyboard.press('Alt+ArrowUp');
	await editor.bridge.waitForSourceMatches(/ZBETAITEM[\s\S]*ZALPHAITEM/);

	// Alt+Down moves it back — structurally identical to the start.
	await page.keyboard.press('Alt+ArrowDown');
	await editor.bridge.waitForSourceMatches(/ZALPHAITEM[\s\S]*ZBETAITEM/);
	await editor.waitForRenderFlush();

	const after = await scrollTopOf(page);
	expect(
		Math.abs(after - baseline),
		`scrollTop drifted ${after - baseline}px over one no-op reorder cycle`
	).toBeLessThan(3);
	expect(pageErrors).toEqual([]);
});
