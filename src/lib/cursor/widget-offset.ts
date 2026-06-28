/**
 * DOM Range ↔ raw-content offset translation for atomic inline widgets.
 * Widgets contribute their raw bytes via data-source-start / data-source-end
 * without contributing to textContent; the walker accumulates text-node
 * lengths plus widget raw lengths. `ambient/` adds the marker prefix on top.
 */

const WIDGET_SELECTOR = '[data-inline-widget]';

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

/**
 * DOM-layer lookup: maps a raw offset to a live `(node, offset)` DOM position.
 * The model-layer counterpart is `core/inline-render.ts` `findNodeAtOffset`,
 * which maps the same offset to a CST inline node without touching the DOM.
 */
export function findRawOffsetTarget(container: HTMLElement, target: number): DomPosition | null {
	let count = 0;
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
				// Prefer landing in an adjacent text node — Chromium drops beforeinput
				// at element-level offsets between two contenteditable=false islands.
				if (count === target && parent) {
					const prev = el.previousSibling;
					if (prev && prev.nodeType === Node.TEXT_NODE) {
						return { node: prev, offset: prev.textContent?.length ?? 0 };
					}
					return { node: parent, offset: idx };
				}
				if (count + len >= target && parent) {
					const next = el.nextSibling;
					if (next && next.nodeType === Node.TEXT_NODE) {
						return { node: next, offset: 0 };
					}
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
	return last;
}

/**
 * Atomic inline widgets in `container` whose raw source range intersects
 * [start, end). A widget contributes 0 chars to textContent, so a range lying
 * entirely inside one collapses to zero width via `createRangeAtRawOffsets` and
 * yields no client rect; callers that must cover the widget (search highlight,
 * cross-block selection) take its bounding box instead. Offsets are the same
 * ambient-included raw positions `findRawOffsetTarget` walks — text-node lengths
 * (including marker-span text) plus widget raw lengths — so a widget's position
 * is the running walk offset, not a naive compare of `data-source-*` against the
 * ambient-adjusted argument.
 */
export function widgetsIntersectingRange(
	container: HTMLElement,
	start: number,
	end: number
): HTMLElement[] {
	const out: HTMLElement[] = [];
	let count = 0;
	function visit(current: Node): void {
		if (current.nodeType === Node.TEXT_NODE) {
			count += current.textContent?.length ?? 0;
			return;
		}
		if (current.nodeType === Node.ELEMENT_NODE) {
			const el = current as Element;
			if (el.matches?.(WIDGET_SELECTOR)) {
				const len = widgetRawLength(el);
				// Half-open intersection of the widget span [count, count+len) with
				// the requested [start, end). A zero-length widget can't be covered.
				if (len > 0 && count < end && start < count + len) {
					out.push(el as HTMLElement);
				}
				count += len;
				return;
			}
			for (const child of current.childNodes) visit(child);
		}
	}
	visit(container);
	return out;
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

/** Raw bytes a DOM subtree stands for: text nodes verbatim, widgets via their source range. */
export function rawTextOfNode(domNode: Node, raw: string): string {
	if (domNode.nodeType === Node.TEXT_NODE) return domNode.textContent ?? '';
	if (domNode.nodeType === Node.ELEMENT_NODE) {
		const el = domNode as Element;
		if (el.matches?.(WIDGET_SELECTOR)) {
			const range = readWidgetSourceRange(el);
			return range ? raw.slice(range.start, range.end) : '';
		}
		let out = '';
		for (const child of Array.from(el.childNodes)) out += rawTextOfNode(child, raw);
		return out;
	}
	return '';
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
	const range = readWidgetSourceRange(el);
	return range ? Math.max(0, range.end - range.start) : 0;
}

/** Widget raw byte range from data-source-* attributes; null when malformed. */
function readWidgetSourceRange(el: Element): { start: number; end: number } | null {
	const start = parseInt(el.getAttribute('data-source-start') ?? '', 10);
	const end = parseInt(el.getAttribute('data-source-end') ?? '', 10);
	if (Number.isNaN(start) || Number.isNaN(end)) return null;
	return { start, end };
}
