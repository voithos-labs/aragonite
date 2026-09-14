import type { Page } from '@playwright/test';

/** Viewport centre of the first rendered run of `needle` in the editor: the aim point for a
 *  press on a word, measured live so a revealed source or a cell reads the same. */
export async function runCenter(page: Page, needle: string): Promise<{ x: number; y: number }> {
	const at = await page.evaluate((w) => {
		const root = document.querySelector('.editor')!;
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let node: Node | null;
		while ((node = walker.nextNode())) {
			const i = (node as Text).data.indexOf(w);
			if (i < 0) continue;
			const r = document.createRange();
			r.setStart(node, i);
			r.setEnd(node, i + w.length);
			const b = r.getBoundingClientRect();
			if (b.width === 0) continue;
			return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
		}
		return null;
	}, needle);
	if (!at) throw new Error(`no rendered run of ${JSON.stringify(needle)}`);
	return at;
}

export function nativeSelectionText(page: Page): Promise<string> {
	return page.evaluate(() => window.getSelection()?.toString() ?? '');
}

/** The editor's own range: its cross-block endpoints, or the single-block range it reports. */
export function editorSelection(page: Page): Promise<unknown> {
	return page.evaluate(() => (window as any).__test.getSelection());
}

/** Press `clicks` times at `from` and drag the last press to `to`. */
export async function multiClickDrag(
	page: Page,
	from: { x: number; y: number },
	to: { x: number; y: number },
	clicks: number
): Promise<void> {
	await page.mouse.move(from.x, from.y);
	for (let i = 1; i < clicks; i++) {
		await page.mouse.down({ clickCount: i });
		await page.mouse.up({ clickCount: i });
	}
	await page.mouse.down({ clickCount: clicks });
	await page.mouse.move(to.x, to.y, { steps: 8 });
	await page.mouse.up({ clickCount: clicks });
}

/** A point a little past the end of the first rendered run of `needle`'s line, still inside the
 *  block's box: where a press lands on no glyph. */
export async function pastLineEnd(page: Page, needle: string): Promise<{ x: number; y: number }> {
	const at = await page.evaluate((w) => {
		const walker = document.createTreeWalker(
			document.querySelector('.editor')!,
			NodeFilter.SHOW_TEXT
		);
		let node: Node | null;
		while ((node = walker.nextNode())) {
			if (!(node as Text).data.includes(w)) continue;
			const r = document.createRange();
			r.selectNodeContents(node);
			const b = r.getBoundingClientRect();
			if (b.width === 0) continue;
			return { x: b.right + 40, y: b.top + b.height / 2 };
		}
		return null;
	}, needle);
	if (!at) throw new Error(`no rendered run of ${JSON.stringify(needle)}`);
	return at;
}

/** A point in the gutter left of the editable holding `needle`: a container's own box. */
export async function gutterLeftOf(page: Page, needle: string): Promise<{ x: number; y: number }> {
	const at = await page.evaluate((w) => {
		const walker = document.createTreeWalker(
			document.querySelector('.editor')!,
			NodeFilter.SHOW_TEXT
		);
		let node: Node | null;
		while ((node = walker.nextNode())) {
			if (!(node as Text).data.includes(w)) continue;
			const surface = node.parentElement?.closest('[contenteditable="true"]');
			const r = document.createRange();
			r.selectNodeContents(node);
			const b = r.getBoundingClientRect();
			if (!surface || b.width === 0) continue;
			return { x: surface.getBoundingClientRect().left - 12, y: b.top + b.height / 2 };
		}
		return null;
	}, needle);
	if (!at) throw new Error(`no rendered run of ${JSON.stringify(needle)}`);
	return at;
}

/** The centre of the ambient `- ` marker inside the editable holding `needle`: an island inside
 *  the surface, not the surface's text. */
export async function markerCenterOf(
	page: Page,
	needle: string
): Promise<{ x: number; y: number }> {
	const at = await page.evaluate((w) => {
		const walker = document.createTreeWalker(
			document.querySelector('.editor')!,
			NodeFilter.SHOW_TEXT
		);
		let node: Node | null;
		while ((node = walker.nextNode())) {
			if (!(node as Text).data.includes(w)) continue;
			const marker = node.parentElement
				?.closest('[contenteditable="true"]')
				?.querySelector('.md-marker[contenteditable="false"]');
			if (!marker) continue;
			const b = marker.getBoundingClientRect();
			return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
		}
		return null;
	}, needle);
	if (!at) throw new Error(`no marker beside ${JSON.stringify(needle)}`);
	return at;
}
