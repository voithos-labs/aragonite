/**
 * Translation between DOM Range positions and raw-content offsets when image
 * widgets contribute to raw without contributing to textContent. Walks the
 * container in document order, accumulating either text-node lengths
 * (textContent contribution) or widget raw lengths (read from
 * `[data-image-widget]` data-source-start / data-source-end). The `ambient/`
 * layer adds the marker prefix on top.
 */

const WIDGET_SELECTOR = '[data-image-widget]';

export function rawOffsetAtNode(container: HTMLElement, node: Node, offset: number): number {
	let count = 0;
	let stopped = false;

	function visit(current: Node): boolean {
		if (stopped) return true;
		if (current === node) {
			if (current.nodeType === Node.TEXT_NODE) {
				count += offset;
			} else {
				const cap = Math.min(offset, current.childNodes.length);
				for (let i = 0; i < cap; i++) {
					if (visit(current.childNodes[i])) return true;
				}
			}
			stopped = true;
			return true;
		}
		if (current.nodeType === Node.TEXT_NODE) {
			count += current.textContent?.length ?? 0;
			return false;
		}
		if (current.nodeType === Node.ELEMENT_NODE) {
			const el = current as Element;
			if (el.matches?.(WIDGET_SELECTOR)) {
				count += widgetRawLength(el);
				return false;
			}
			for (const child of current.childNodes) {
				if (visit(child)) return true;
			}
		}
		return false;
	}

	visit(container);
	return count;
}

export interface DomPosition {
	node: Node;
	offset: number;
}

export function findRawOffsetTarget(container: HTMLElement, target: number): DomPosition | null {
	let count = 0;
	let exact: DomPosition | null = null;
	let last: DomPosition | null = null;

	function visit(current: Node): DomPosition | null {
		if (current.nodeType === Node.TEXT_NODE) {
			const len = current.textContent?.length ?? 0;
			if (count + len >= target) {
				return { node: current, offset: target - count };
			}
			count += len;
			last = { node: current, offset: len };
			return null;
		}
		if (current.nodeType === Node.ELEMENT_NODE) {
			const el = current as Element;
			if (el.matches?.(WIDGET_SELECTOR)) {
				const len = widgetRawLength(el);
				const parent = el.parentNode;
				const idx = parent ? Array.prototype.indexOf.call(parent.childNodes, el) : 0;
				// Target at widget's leading boundary → before widget.
				if (count === target && parent) {
					exact = { node: parent, offset: idx };
					return exact;
				}
				if (count + len >= target && parent) {
					// Target at trailing boundary or anywhere inside → after widget.
					return { node: parent, offset: idx + 1 };
				}
				count += len;
				if (parent) last = { node: parent, offset: idx + 1 };
				return null;
			}
			for (const child of current.childNodes) {
				const result = visit(child);
				if (result) return result;
			}
		}
		return null;
	}

	const found = visit(container);
	if (found) return found;
	if (exact) return exact;
	return last;
}

export function containerRawLength(container: HTMLElement): number {
	let count = 0;
	function visit(node: Node): void {
		if (node.nodeType === Node.TEXT_NODE) {
			count += node.textContent?.length ?? 0;
			return;
		}
		if (node.nodeType === Node.ELEMENT_NODE) {
			const el = node as Element;
			if (el.matches?.(WIDGET_SELECTOR)) {
				count += widgetRawLength(el);
				return;
			}
			for (const child of node.childNodes) visit(child);
		}
	}
	visit(container);
	return count;
}

export function createRangeAtRawOffsets(
	container: HTMLElement,
	start: number,
	end: number
): Range | null {
	const range = document.createRange();
	const startPos = findRawOffsetTarget(container, start);
	if (!startPos) {
		range.selectNodeContents(container);
		range.collapse(false);
		return range;
	}
	try {
		range.setStart(startPos.node, startPos.offset);
	} catch {
		return null;
	}
	if (start === end) {
		range.collapse(true);
		return range;
	}
	const endPos = findRawOffsetTarget(container, end);
	if (endPos) {
		try {
			range.setEnd(endPos.node, endPos.offset);
		} catch {
			range.setEndAfter(container);
		}
	} else {
		range.setEndAfter(container);
	}
	return range;
}

function widgetRawLength(el: Element): number {
	const start = parseInt(el.getAttribute('data-source-start') ?? '', 10);
	const end = parseInt(el.getAttribute('data-source-end') ?? '', 10);
	if (Number.isNaN(start) || Number.isNaN(end)) return 0;
	return Math.max(0, end - start);
}
