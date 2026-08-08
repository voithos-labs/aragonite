import { expect, type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';

// Shared pointer and caret helpers for the presentation specs.

// The attribute check is load-bearing: an unwhitelisted query param falls back to source, where
// every marker is painted and a live scenario would pass without live. Source itself stamps no
// attribute, which is the same fact from the other side.
export async function enterPresentationMode(
	page: Page,
	mode: 'live' | 'source',
	doc: string
): Promise<EditorPage> {
	const ep = new EditorPage(page);
	await ep.goto(`?presentationMode=${mode}`);
	await ep.loadContent(doc);
	if (mode === 'source') await expect(ep.editorContainer).not.toHaveAttribute('data-presentation');
	else await expect(ep.editorContainer).toHaveAttribute('data-presentation', mode);
	return ep;
}

export async function focusOffset(ep: EditorPage): Promise<number> {
	return (await ep.bridge.getSelectionPaths())?.focus.offset ?? -1;
}

async function focusPath(ep: EditorPage): Promise<number[]> {
	return (await ep.bridge.getSelectionPaths())?.focus.path ?? [];
}

/** A click's caret is what every scenario starts from, and the bridge reporting NO selection is
 *  the shape a lost click takes — so settle on the caret existing rather than on the click. */
export async function clickBlockSettled(ep: EditorPage, index: number): Promise<void> {
	await ep.clickBlock(index);
	await expect.poll(() => focusOffset(ep), { timeout: 2000 }).toBeGreaterThanOrEqual(0);
}

export async function clickWordSettled(ep: EditorPage, page: Page, word: string): Promise<void> {
	const point = await centerOfWord(page, word);
	await page.mouse.click(point.x, point.y);
	await ep.waitForRenderFlush();
	await expect.poll(() => focusOffset(ep), { timeout: 2000 }).toBeGreaterThanOrEqual(0);
}

/** Step with `key` until the caret reports `target` — the arrival is a real gesture, never a
 *  programmatic seat. A walk that leaves the block is a failure, not a longer walk: the offsets
 *  restart there, and the target would be reached in the wrong block. */
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

// Center pixel of the first visible text node containing `word` — clicks a
// marker-adjacent word without relying on raw-offset geometry (hidden markers
// have no layout box, so a raw-offset walk mis-measures them).
export async function centerOfWord(page: Page, word: string): Promise<{ x: number; y: number }> {
	const point = await page.evaluate((w) => {
		const root = document.querySelector('.editor')!;
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let node: Node | null;
		while ((node = walker.nextNode())) {
			const i = node.textContent?.indexOf(w) ?? -1;
			if (i >= 0) {
				const range = document.createRange();
				range.setStart(node, i);
				range.setEnd(node, i + w.length);
				const rect = range.getBoundingClientRect();
				return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
			}
		}
		return null;
	}, word);
	if (!point) throw new Error(`centerOfWord: "${word}" not found`);
	return point;
}

// Pixel just inside `word`'s trailing edge — the one gesture that lands a caret at a
// construct's content edge by CLICK. A hidden delimiter run has no box, so the nearest
// character boundary to this pixel is the edge itself.
export async function trailingEdgeOfWord(
	page: Page,
	word: string
): Promise<{ x: number; y: number }> {
	const point = await page.evaluate((w) => {
		const root = document.querySelector('.editor')!;
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let node: Node | null;
		while ((node = walker.nextNode())) {
			const i = node.textContent?.indexOf(w) ?? -1;
			if (i >= 0) {
				const range = document.createRange();
				range.setStart(node, i);
				range.setEnd(node, i + w.length);
				const rect = range.getBoundingClientRect();
				return { x: rect.right - 1, y: rect.top + rect.height / 2 };
			}
		}
		return null;
	}, word);
	if (!point) throw new Error(`trailingEdgeOfWord: "${word}" not found`);
	return point;
}
