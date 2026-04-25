/**
 * DOM renderer for InlineNode trees. textContent of the returned fragment
 * equals raw.slice over the covered range — every character in raw has a
 * corresponding text node in the DOM.
 */

import type { InlineNode } from './nodes';

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

	let openEnd: number;
	let closeStart: number;

	if (children.length > 0) {
		openEnd = children[0].start;
		closeStart = children[children.length - 1].end;
	} else {
		// No children — entire interior is markers; split in half.
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
				// Text node carries the line ending (LF or CRLF) so textContent equals
				// raw byte-for-byte; <br> would diverge across browsers.
				const breakRaw = raw.slice(node.start, node.end);
				const nlIdx = breakRaw.indexOf('\n');
				const lineEndingStart = nlIdx > 0 && breakRaw[nlIdx - 1] === '\r' ? nlIdx - 1 : nlIdx;
				if (lineEndingStart > 0) {
					frag.appendChild(markerSpan(breakRaw.slice(0, lineEndingStart)));
				}
				frag.appendChild(document.createTextNode(breakRaw.slice(lineEndingStart)));
				break;
			}

			case 'link': {
				// Markers come from raw.slice; never reconstruct from parsed fields
				// (the parsed url/title can differ from the source bytes).
				const children = node.children ?? [];
				if (children.length > 0) {
					const openMarker = raw.slice(node.start, children[0].start);
					const closeMarker = raw.slice(children[children.length - 1].end, node.end);
					frag.appendChild(markerSpan(openMarker));
					const anchor = document.createElement('a');
					anchor.className = 'md-link-content';
					anchor.appendChild(renderInlineNodes(children, raw));
					frag.appendChild(anchor);
					frag.appendChild(markerSpan(closeMarker));
				} else {
					// Empty link text: [](url)
					const mid = raw.indexOf(']', node.start);
					frag.appendChild(markerSpan(raw.slice(node.start, mid !== -1 ? mid : node.end)));
					if (mid !== -1) frag.appendChild(markerSpan(raw.slice(mid, node.end)));
				}
				break;
			}

			case 'image': {
				const altText = node.alt ?? '';
				const altStart = node.start + 2; // after '!['
				const altEnd = altStart + altText.length;
				frag.appendChild(markerSpan(raw.slice(node.start, altStart)));
				frag.appendChild(document.createTextNode(altText));
				frag.appendChild(markerSpan(raw.slice(altEnd, node.end)));
				break;
			}

			case 'autolink': {
				const span = document.createElement('span');
				span.className = 'md-autolink';
				span.textContent = raw.slice(node.start, node.end);
				frag.appendChild(span);
				break;
			}

			case 'escape': {
				frag.appendChild(markerSpan(raw[node.start]));
				frag.appendChild(document.createTextNode(raw.slice(node.start + 1, node.end)));
				break;
			}

			case 'entityReference': {
				const span = document.createElement('span');
				span.className = 'md-entity';
				span.textContent = raw.slice(node.start, node.end);
				frag.appendChild(span);
				break;
			}
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
 * Find the leaf InlineNode containing `offset`. At boundaries between nodes,
 * prefers the right node; `offset === end` only matches the last node.
 */
export function findNodeAtOffset(nodes: InlineNode[], offset: number): OffsetResult | null {
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		const isLast = i === nodes.length - 1;

		const inRange = offset >= node.start && (offset < node.end || (isLast && offset === node.end));
		if (!inRange) continue;

		if (node.children && node.children.length > 0) {
			const childResult = findNodeAtOffset(node.children, offset);
			if (childResult) return childResult;
		}

		return { node, localOffset: offset - node.start };
	}

	return null;
}
