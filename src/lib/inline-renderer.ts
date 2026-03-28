/**
 * DOM renderer for InlineNode trees produced by the inline parser.
 * Builds a DocumentFragment where textContent equals the raw content slice.
 */

import type { InlineNode } from './core/nodes';

// ── Marker helpers ──────────────────────────────────────────────────────────

function markerSpan(text: string): HTMLSpanElement {
	const span = document.createElement('span');
	span.className = 'md-marker';
	span.textContent = text;
	return span;
}

// ── Inline code ─────────────────────────────────────────────────────────────

function renderInlineCode(node: InlineNode, raw: string): DocumentFragment {
	const frag = document.createDocumentFragment();
	const content = node.text ?? '';
	// tick length = (total span length - content length) / 2
	const tickLen = (node.end - node.start - content.length) / 2;
	const ticks = raw.slice(node.start, node.start + tickLen);

	frag.appendChild(markerSpan(ticks));

	const code = document.createElement('code');
	code.className = 'inline-code-content';
	code.textContent = content;
	frag.appendChild(code);

	frag.appendChild(markerSpan(ticks));
	return frag;
}

// ── Wrapped spans (emphasis / strong / strikethrough) ───────────────────────

function renderWrapped(node: InlineNode, raw: string, tag: string): DocumentFragment {
	const frag = document.createDocumentFragment();
	const children = node.children ?? [];

	// Determine open/close marker lengths from gaps between node bounds and children
	let openEnd: number;
	let closeStart: number;

	if (children.length > 0) {
		openEnd = children[0].start;
		closeStart = children[children.length - 1].end;
	} else {
		// No children — entire interior is markers; split in half
		const mid = node.start + Math.floor((node.end - node.start) / 2);
		openEnd = mid;
		closeStart = mid;
	}

	const openMarker = raw.slice(node.start, openEnd);
	const closeMarker = raw.slice(closeStart, node.end);

	frag.appendChild(markerSpan(openMarker));

	const wrapper = document.createElement(tag);
	const innerFrag = renderInlineNodes(children, raw);
	wrapper.appendChild(innerFrag);
	frag.appendChild(wrapper);

	frag.appendChild(markerSpan(closeMarker));
	return frag;
}

// ── Main renderer ────────────────────────────────────────────────────────────

/**
 * Build a DocumentFragment from an InlineNode[] tree.
 * The textContent of the returned fragment equals raw.slice over the covered range.
 * Every character in `raw` has a corresponding text node in the DOM.
 */
export function renderInlineNodes(nodes: InlineNode[], raw: string): DocumentFragment {
	const frag = document.createDocumentFragment();

	for (const node of nodes) {
		switch (node.kind) {
			case 'text':
				frag.appendChild(document.createTextNode(node.text ?? ''));
				break;

			case 'inlineCode':
				frag.appendChild(renderInlineCode(node, raw));
				break;

			case 'emphasis':
				frag.appendChild(renderWrapped(node, raw, 'em'));
				break;

			case 'strong':
				frag.appendChild(renderWrapped(node, raw, 'strong'));
				break;

			case 'strikethrough':
				frag.appendChild(renderWrapped(node, raw, 's'));
				break;

			case 'hardLineBreak': {
				// Marker span holds the raw trailing-space or backslash chars, then <br>
				const markerText = raw.slice(node.start, node.end).replace(/\n$/, '');
				frag.appendChild(markerSpan(markerText));
				frag.appendChild(document.createElement('br'));
				break;
			}

			case 'link':
			case 'image':
			case 'autolink':
				// Placeholder: render as plain raw text
				frag.appendChild(document.createTextNode(raw.slice(node.start, node.end)));
				break;
		}
	}

	return frag;
}

// ── Cursor mapping ───────────────────────────────────────────────────────────

export interface OffsetResult {
	node: InlineNode;
	localOffset: number;
}

/**
 * Find the leaf InlineNode containing the given raw offset.
 * At boundaries between nodes, prefers the right node.
 * Returns null only when nodes is empty and offset is unreachable.
 */
export function findNodeAtOffset(nodes: InlineNode[], offset: number): OffsetResult | null {
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		const isLast = i === nodes.length - 1;

		// Boundary at node.start: prefer this node (right node at boundary)
		// Interior: offset strictly within [start, end)
		// End boundary: only for the last node, allow offset === end
		const inRange = offset >= node.start && (offset < node.end || (isLast && offset === node.end));
		if (!inRange) continue;

		// Recurse into children if present
		if (node.children && node.children.length > 0) {
			const childResult = findNodeAtOffset(node.children, offset);
			if (childResult) return childResult;
		}

		return { node, localOffset: offset - node.start };
	}

	return null;
}

/**
 * Place a collapsed cursor inside `el` at the given character offset.
 * Walks DOM text nodes counting characters, mirroring createRangeFromOffsets
 * in TextEditableBlock.svelte.
 */
export function setCursorFromRawOffset(el: HTMLElement, offset: number): void {
	const range = document.createRange();
	let charCount = 0;
	let placed = false;

	function walk(node: Node): boolean {
		if (node.nodeType === Node.TEXT_NODE) {
			const len = node.textContent?.length ?? 0;
			if (charCount + len >= offset) {
				range.setStart(node, offset - charCount);
				range.collapse(true);
				placed = true;
				return true;
			}
			charCount += len;
		} else {
			for (const child of node.childNodes) {
				if (walk(child)) return true;
			}
		}
		return false;
	}

	walk(el);

	if (!placed) {
		// Offset beyond content — place cursor at end
		range.selectNodeContents(el);
		range.collapse(false);
	}

	const sel = window.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(range);
}
