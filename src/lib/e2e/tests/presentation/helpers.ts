import { type Page } from '@playwright/test';

// Shared pointer helper for the presentation preview specs.

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
