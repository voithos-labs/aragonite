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

// Edits and unmounts away from what is on screen: an insert above it shifts every index below,
// a cell scrolled out of view leaves a column's width, and a move below it relocates the block
// the correction would otherwise follow. Each holds the viewport still in a different way, and
// each has its own way of being broken.

function scrollTopOf(page: Page): Promise<number> {
	return page.evaluate(() => (document.querySelector('.editor') as HTMLElement).scrollTop);
}

// F4: an anchor held by index measures a different block after the shift and over-corrects by
// about one block's height; holding it by id fixes that. Here a block's position is what tells
// them apart, unlike the deep-jump cases, because the children really change. Driven in code on
// a nested list, since the blocks above the fold are unmounted and there is nothing to click.
test('inserting a block above the fold holds the viewport via anchor remap (F4)', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();

	// Uneven on purpose: in a document of equal blocks the inserted one matches whatever was at
	// that index and the correction by index comes out right by accident.
	await editor.loadContent(buildNonUniformBlockquoteDoc());
	expect(await cstBlockCount(page)).toBe(1);
	expect(await spacerCount(page, '.blockquote-block')).toBeGreaterThan(0);

	// Step by step: going back to estimates only shows where the measured heights around the
	// anchor differ from those estimates.
	await progressiveScrollTo(editor, Math.round((await editorScrollHeight(page)) / 2));
	await editor.waitForRenderFlush();

	const topHost = await topVisibleHostTop(page, { selector: '[data-block-path*=","]' });
	expect(topHost).not.toBeNull();
	const before = { childIndex: (JSON.parse(topHost!.ref!) as number[])[1], y: topHost!.top };
	expect(before.childIndex).toBeGreaterThan(5); // the insert is far above the visible area

	const childCountBefore = await page.evaluate(
		() => (window as any).__test.getDocument().children[0].children.length
	);

	// Child 0 is well above the viewport, in the unmounted part; `spliceContainerChildren` keeps
	// `childIds` in step, so the rebuild runs with a valid id and moves no scroll.
	await page.evaluate(() => {
		const tall = `> inserted${'<br>line'.repeat(30)}\n`;
		(window as any).__test.spliceContainerChildren([0], 0, 0, tall);
	});
	expect(
		await page.evaluate(() => (window as any).__test.getDocument().children[0].children.length)
	).toBe(childCountBefore + 1);
	await editor.waitForRenderFlush();

	// The anchor child sits one index later after the insert; held by index instead of by id,
	// the correction overshoots and it jumps by about the inserted block's height.
	const after = await page.evaluate((childIndex) => {
		const host = document.querySelector(
			`[data-block-path='${JSON.stringify([0, childIndex])}']`
		) as HTMLElement | null;
		return host ? host.getBoundingClientRect().top : null;
	}, before.childIndex + 1);

	const drift = after !== null ? Math.abs(after - before.y) : Infinity;
	console.log(`F4 anchor-remap ${JSON.stringify({ ...before, after, drift })}`);

	expect(after).not.toBeNull();
	// 40px is below the inserted block's height, which is how far it would jump, and above noise.
	expect(drift).toBeLessThan(40);
	expect(pageErrors).toEqual([]);
});

// F6: `minmax(80px, max-content)` sizes a column to the cells mounted at that moment, so the
// column reflows mid-scroll once its widest cell unmounts. The fix holds each column at the
// widest cell seen so far, so it only ever grows.
test('a column does not shrink when its widest cell scrolls out of the window (F6)', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();

	// Exactly one wide cell, near the top, so column 0's width comes entirely from it and a
	// deep scroll that unmounts its row is what collapses the column.
	const wide = 'wordwordword '.repeat(20).trim();
	const header = '| a | b | c |\n| --- | --- | --- |\n';
	const body = Array.from({ length: 800 }, () => `| p | q | r |`).join('\n') + '\n';
	await editor.loadContent(`${header}| ${wide} | y | z |\n${body}`);

	// Without row windowing the wide cell never unmounts and the test proves nothing.
	expect(await spacerCount(page, '.table-block >')).toBeGreaterThan(0);

	// Any mounted row reports the shared column width; the wide row is mounted at the start.
	const firstCellWidth = () =>
		page.evaluate(() => {
			const cell = document.querySelector(
				'[data-table-row-idx] > .table-cell'
			) as HTMLElement | null;
			return cell ? cell.getBoundingClientRect().width : null;
		});
	const widthBefore = await firstCellWidth();
	expect(widthBefore).not.toBeNull();
	// A sanity check: the wide cell really did stretch column 0 past the 80px minimum.
	expect(widthBefore!).toBeGreaterThan(200);

	await editor.scrollEditorTo(Math.round((await editorScrollHeight(page)) * 0.9));
	await editor.waitForRenderFlush();

	// If the wide row is still in the DOM, the column stays wide for the wrong reason.
	expect(await page.evaluate(() => document.querySelector('[data-table-row-idx="1"]'))).toBeNull();

	const widthAfter = await firstCellWidth();
	console.log(`F6 column-stability ${JSON.stringify({ widthBefore, widthAfter })}`);

	expect(widthAfter).not.toBeNull();
	// 0.9 of the width allows for sub-pixel jitter while failing on the several hundred pixels
	// a column that is not held at its widest collapses by.
	expect(widthAfter!).toBeGreaterThan(widthBefore! * 0.9);
	expect(pageErrors).toEqual([]);
});

// F7: with nothing scrolled above the viewport's top (localScrollTop is 0), the list's
// `correctAnchorByStableId` would follow the moved block and shift the shared scrollTop. One
// Alt+Up and one Alt+Down leave the structure as it was, so scrollTop must come back.
test('reordering a list item below the fold does not drift scrollTop (F7)', async ({ page }) => {
	const pageErrors = capturePageErrors(page);
	const editor = new EditorPage(page);
	await editor.goto();

	// Filler on both sides, so the list can move either way rather than stopping at an edge,
	// with ALPHA tall and BETA short so following the anchor would move it by an uneven amount.
	const pre = Array.from({ length: 60 }, (_, i) => `pre filler ${i}`).join('\n\n');
	const post = Array.from({ length: 60 }, (_, i) => `post filler ${i}`).join('\n\n');
	const tall = `ZALPHAITEM ${'word '.repeat(40)}`.trim();
	await editor.loadContent(`${pre}\n\n1. ${tall}\n2. ZBETAITEM\n\n${post}\n`);

	// Where the first mounted block containing `text` sits, or null when it is not mounted.
	const offsetOf = (text: string) =>
		page.evaluate((t) => {
			const ed = document.querySelector('.editor') as HTMLElement;
			const host = [...document.querySelectorAll('[data-block-path]')].find((h) =>
				(h.textContent || '').includes(t)
			);
			if (!host) return null;
			return host.getBoundingClientRect().top - ed.getBoundingClientRect().top + ed.scrollTop;
		}, text);

	// Scroll until the list mounts, then leave its top about 250px below the editor's viewport
	// top, which is what makes the list's own localScrollTop 0.
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

	// The baseline is taken after the click, so any scroll the click caused is included in it.
	await page.locator('[contenteditable="true"]', { hasText: 'ZBETAITEM' }).click();
	await editor.waitForRenderFlush();

	const listTopRel = (await offsetOf('ZALPHAITEM'))! - (await scrollTopOf(page));
	// Without this the test never reaches the path it is about.
	expect(listTopRel, 'list must sit below the viewport top (localScrollTop===0)').toBeGreaterThan(
		50
	);

	const baseline = await scrollTopOf(page);

	// Ordered list markers renumber, so the move shows up in the serialized source.
	await page.keyboard.press('Alt+ArrowUp');
	await editor.bridge.waitForSourceMatches(/ZBETAITEM[\s\S]*ZALPHAITEM/);

	// Alt+Down moves it back, leaving the structure exactly as it started.
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
