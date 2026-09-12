import { test, expect } from '../../fixtures';
import type { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { clickBlockSettled, enterPresentationMode, focusOffset } from './helpers';

// A flip re-seats the caret but writes no scrollport (#155): the restore rides the bare mount, the
// road the history swap already takes. Requirements:
// e2e/requirements/presentation/presentation-mode-flip-scroll.md.

const TALL = `${Array.from(
	{ length: 120 },
	(_, i) => `Paragraph ${i} with **bold** and some more text to wrap`
).join('\n\n')}\n`;

// Fences lose their two marker lines in live, so every mounted code block above the viewport
// shrinks at the flip; the prose between them stays the height it was.
const FENCED = `${Array.from(
	{ length: 60 },
	(_, i) =>
		`Paragraph ${i} ahead of a fence.\n\n\`\`\`js\nconst n${i} = ${i};\nconsole.log(n${i});\n\`\`\``
).join('\n\n')}\n`;

/** Well past the caret's block, so a scrolling restore has somewhere to yank the viewport to. */
const PARKED = 900;

async function scrollTop(page: Page): Promise<number> {
	return page.evaluate(() => document.querySelector('.editor')!.scrollTop);
}

/** Click `testid` and settle on the mode the toggle switches to (or back to source). */
async function flipTo(ep: EditorPage, page: Page, testid: string, mode?: string): Promise<void> {
	await page.getByTestId(testid).click();
	if (mode) await expect(ep.editorContainer).toHaveAttribute('data-presentation', mode);
	else await expect(ep.editorContainer).not.toHaveAttribute('data-presentation');
	await ep.waitForRenderFlush();
}

/** Is the caret's block mounted, and is it still out of sight above the viewport? A block
 *  mounted only because something scrolled to it reads `aboveViewport: false`. */
async function caretBlockPlacement(
	page: Page
): Promise<{ mounted: boolean; aboveViewport: boolean }> {
	return page.evaluate(() => {
		const host = document.querySelector("[data-block-path='[1]']");
		if (!host) return { mounted: false, aboveViewport: false };
		const port = document.querySelector('.editor')!;
		return {
			mounted: true,
			aboveViewport: host.getBoundingClientRect().bottom < port.getBoundingClientRect().top
		};
	});
}

/** The first host whose box reaches below the viewport top: the block the reader is looking at. */
async function topVisibleHost(page: Page): Promise<{ path: string | null; top: number } | null> {
	return page.evaluate(() => {
		const portTop = document.querySelector('.editor')!.getBoundingClientRect().top;
		const hosts = Array.from(
			document.querySelectorAll('.editor [data-block-path]:not([data-block-path*=","])')
		) as HTMLElement[];
		for (const host of hosts) {
			const rect = host.getBoundingClientRect();
			if (rect.bottom > portTop + 1)
				return { path: host.getAttribute('data-block-path'), top: rect.top };
		}
		return null;
	});
}

test.describe('mode flips — the scrollport stays where the reader left it', () => {
	test('the round trip through reading holds the scroll and still re-seats the caret', async ({
		page
	}) => {
		const ep = await enterPresentationMode(page, 'source', TALL);
		await clickBlockSettled(ep, 1);
		await ep.scrollEditorTo(PARKED);
		const parked = await scrollTop(page);
		expect(parked, 'the fixture must be tall enough to scroll').toBeGreaterThan(100);

		await flipTo(ep, page, 'presentation-toggle', 'reading');
		expect(await scrollTop(page)).toBeCloseTo(parked, 0);

		await flipTo(ep, page, 'presentation-toggle');
		// Non-vacuity: a flip that restored nothing would hold the scroll trivially.
		await expect.poll(() => focusOffset(ep), { timeout: 5000 }).toBeGreaterThanOrEqual(0);
		expect(await scrollTop(page)).toBeCloseTo(parked, 0);
	});

	const EDITABLE_RUNGS = [
		['preview-block', 'preview-block-toggle'],
		['preview-inline', 'preview-inline-toggle'],
		['live', 'live-toggle']
	] as const;

	for (const [mode, testid] of EDITABLE_RUNGS) {
		test(`the ${mode} round trip holds the scroll`, async ({ page }) => {
			const ep = await enterPresentationMode(page, 'source', TALL);
			await clickBlockSettled(ep, 1);
			await ep.scrollEditorTo(PARKED);
			const parked = await scrollTop(page);

			await flipTo(ep, page, testid, mode);
			await expect.poll(() => focusOffset(ep), { timeout: 5000 }).toBeGreaterThanOrEqual(0);
			expect(await scrollTop(page), `into ${mode}`).toBeCloseTo(parked, 0);

			await flipTo(ep, page, testid);
			await expect.poll(() => focusOffset(ep), { timeout: 5000 }).toBeGreaterThanOrEqual(0);
			expect(await scrollTop(page), `out of ${mode}`).toBeCloseTo(parked, 0);
		});
	}
	// The pin, not the number. The flip blurs before it re-seats the caret, so anything that
	// recomputes the window in that gap drops the caret's block from the mounted set and the
	// re-seat has to scroll it back. Mounted AND still out of sight says the pin carried it,
	// where the scroll assertions above only say the number did not move (#221).
	test('the caret block rides a flip mounted, never scrolled back into view', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'source', TALL);
		await clickBlockSettled(ep, 1);
		await ep.scrollEditorTo(PARKED);
		const parked = await scrollTop(page);
		const pinned = { mounted: true, aboveViewport: true };
		expect(await caretBlockPlacement(page), 'parked, caret block out of sight').toEqual(pinned);

		await flipTo(ep, page, 'live-toggle', 'live');
		await expect.poll(() => focusOffset(ep), { timeout: 5000 }).toBeGreaterThanOrEqual(0);
		expect(await caretBlockPlacement(page), 'into live').toEqual(pinned);
		expect(await scrollTop(page), 'into live').toBeCloseTo(parked, 0);

		await flipTo(ep, page, 'live-toggle');
		await expect.poll(() => focusOffset(ep), { timeout: 5000 }).toBeGreaterThanOrEqual(0);
		expect(await caretBlockPlacement(page), 'out of live').toEqual(pinned);
		expect(await scrollTop(page), 'out of live').toBeCloseTo(parked, 0);
	});

	// The block under the reader's eyes, not the scroll number: when mounted blocks above the
	// viewport change height at the flip, holding the number would slide the content, so the
	// windowing correction moves the number by exactly what those blocks lost.
	test('a flip that resizes mounted blocks above the viewport holds the block in view', async ({
		page
	}) => {
		const ep = await enterPresentationMode(page, 'source', FENCED);
		await ep.scrollEditorTo(PARKED * 3);
		const before = await topVisibleHost(page);
		expect(before, 'a block is in view').not.toBeNull();

		await flipTo(ep, page, 'live-toggle', 'live');
		const after = await topVisibleHost(page);
		expect(after?.path, 'the same block leads the viewport').toBe(before!.path);
		// A device-pixel band: each fence's correction is a fractional delta the scroller rounds.
		expect(Math.abs(after!.top - before!.top), 'at the same place').toBeLessThan(2);
	});
});
