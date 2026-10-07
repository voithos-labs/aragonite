import { expect, type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { textRunCenter, textRunEnd } from '../../text-runs';

// Shared pointer and caret helpers for the presentation specs.

export async function enterPresentationMode(
	page: Page,
	mode: 'live' | 'preview-inline' | 'preview-block' | 'reading' | 'source',
	doc: string
): Promise<EditorPage> {
	const ep = new EditorPage(page);
	await ep.goto(`?presentationMode=${mode}`);
	await ep.loadContent(doc);
	return ep;
}

/** Loads `doc` for the next step of a test that walks several rows, as a fresh page would have it:
 *  nothing focused, so the caret isn't left in the swapped block, and a new document. */
export async function nextRow(ep: EditorPage, doc: string): Promise<void> {
	await ep.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await ep.loadContent(doc);
}

export async function clickEnd(ep: EditorPage, page: Page, word: string): Promise<void> {
	const point = await textRunEnd(page, word);
	await page.mouse.click(point.x, point.y);
	await ep.waitForRenderFlush();
}

/** Presses each key in turn, letting the render settle after every press. */
export async function keys(ep: EditorPage, page: Page, ...pressed: string[]): Promise<void> {
	for (const key of pressed) {
		await page.keyboard.press(key);
		await ep.waitForRenderFlush();
	}
}

/** The constructs the edge ring (`md-edge-held`) is on, by tag name. */
export const held = (page: Page): Promise<string[]> =>
	page.evaluate(() =>
		[...document.querySelectorAll('.md-edge-held')].map((el) => el.tagName.toLowerCase())
	);

export async function focusOffset(ep: EditorPage): Promise<number> {
	return (await ep.bridge.getSelectionPaths())?.focus.offset ?? -1;
}

export async function focusPath(ep: EditorPage): Promise<number[]> {
	return (await ep.bridge.getSelectionPaths())?.focus.path ?? [];
}

/** Presses `key` `times` over and reports where the caret landed. */
export async function press(ep: EditorPage, page: Page, key: string, times = 1): Promise<number> {
	for (let i = 0; i < times; i++) await page.keyboard.press(key);
	await ep.waitForRenderFlush();
	return focusOffset(ep);
}

/** Every scenario starts from the caret a click leaves, and a lost click shows up as the bridge
 *  reporting no selection, so wait on the caret existing rather than on the click. */
export async function clickBlockSettled(ep: EditorPage, index: number): Promise<void> {
	await ep.clickBlock(index);
	await expect.poll(() => focusOffset(ep), { timeout: 5000 }).toBeGreaterThanOrEqual(0);
}

export async function clickWordSettled(ep: EditorPage, page: Page, word: string): Promise<void> {
	const point = await textRunCenter(page, word);
	await page.mouse.click(point.x, point.y);
	await ep.waitForRenderFlush();
	await expect.poll(() => focusOffset(ep), { timeout: 5000 }).toBeGreaterThanOrEqual(0);
}

/** Steps with `key` until the caret reports `target`; leaving the block fails, since offsets
 *  restart there and the target would be reached in the wrong block. */
export async function stepTo(
	ep: EditorPage,
	page: Page,
	key: string,
	target: number
): Promise<void> {
	const start = await focusPath(ep);
	for (let i = 0; i < 16; i++) {
		if ((await focusOffset(ep)) === target) return;
		await page.keyboard.press(key);
		await ep.waitForRenderFlush();
		const path = await focusPath(ep);
		if (path.join() !== start.join()) {
			throw new Error(`stepTo: ${key} left block [${start}] for [${path}]`);
		}
	}
	throw new Error(`stepTo: ${key} never reached offset ${target} (at ${await focusOffset(ep)})`);
}

/** A click at a word's center resolves mid-glyph, so which boundary it picks is font-metric luck;
 *  stepping to `target` makes the offset deterministic. */
export async function landAt(ep: EditorPage, page: Page, target: number): Promise<void> {
	const at = await focusOffset(ep);
	if (at === target) return;
	await stepTo(ep, page, at < target ? 'ArrowRight' : 'ArrowLeft', target);
}

/** The selection counterpart of {@link stepTo}: a programmatic range would skip the input event
 *  live mode intercepts. */
export async function extendTo(
	ep: EditorPage,
	page: Page,
	key: string,
	path: number[],
	offset: number
): Promise<void> {
	for (let i = 0; i < 40; i++) {
		const focus = (await ep.bridge.getSelectionPaths())?.focus;
		if (focus && focus.path.join() === path.join() && focus.offset === offset) return;
		await page.keyboard.press(`Shift+${key}`);
		await ep.waitForRenderFlush();
	}
	const focus = (await ep.bridge.getSelectionPaths())?.focus;
	throw new Error(
		`extendTo: Shift+${key} never reached [${path}]@${offset} (at [${focus?.path}]@${focus?.offset})`
	);
}
