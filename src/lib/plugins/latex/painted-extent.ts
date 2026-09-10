/**
 * The horizontal span a rendered equation actually paints, read off its text runs: the render box
 * is the block's full width with the equation centred in it, so the box says nothing about where
 * the ink is. Engine-agnostic (text nodes, not KaTeX classes); a renderer painting no text at all
 * answers null and the caller treats the whole box as ink.
 */
export function paintedExtent(container: HTMLElement): { left: number; right: number } | null {
	let left = Infinity;
	let right = -Infinity;
	const range = document.createRange();
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if ((node as Text).data.trim() === '') continue;
		range.selectNodeContents(node);
		for (const rect of range.getClientRects()) {
			if (rect.width === 0) continue;
			left = Math.min(left, rect.left);
			right = Math.max(right, rect.right);
		}
	}
	return left <= right ? { left, right } : null;
}
