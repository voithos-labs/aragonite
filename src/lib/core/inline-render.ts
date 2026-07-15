/**
 * DOM renderer for InlineNode trees. textContent of the returned fragment
 * equals raw.slice over the covered range — every character in raw has a
 * corresponding text node in the DOM.
 */

import type { InlineNode } from './nodes';
import { buildCoreInlineWidget } from './inline/inline-widgets';
import { isAllowedHrefScheme } from './url-policy';

// ── Render options ──────────────────────────────────────────────────────────

export type ImageLoadPolicy = 'auto' | 'placeholder';

export interface RenderInlineOptions {
	renderImagesAsWidgets?: boolean;
	resolveImageUrl?: (rawUrl: string) => string;
	/** Render-time href rewrite for links/autolinks (default identity). */
	resolveLinkUrl?: (rawUrl: string) => string;
	/** Whether remote images auto-load (default) or defer to a placeholder. */
	imageLoadPolicy?: ImageLoadPolicy;
	/**
	 * Builds the atomic image-widget DOM. Injected by the component layer so
	 * `core/` owns no image-widget specifics; absent → images render alt-only.
	 */
	buildImageWidget?: (
		node: InlineNode,
		raw: string,
		opts: {
			resolveImageUrl: (rawUrl: string) => string;
			imageLoadPolicy: ImageLoadPolicy;
		}
	) => Node;
	/**
	 * Builds a `component`-kind widget's DOM by mounting its Svelte component in the
	 * atomic-island wrapper. Injected by the component layer so `core/` owns no
	 * portal specifics; absent or null → the widget falls back to its raw source.
	 */
	buildPortalWidget?: (node: InlineNode, raw: string) => HTMLElement | null;
}

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

function renderWrapped(
	node: InlineNode,
	raw: string,
	tag: string,
	opts: RenderInlineOptions
): DocumentFragment {
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
	const innerFrag = renderInlineNodes(children, raw, opts);
	wrapper.appendChild(innerFrag);
	frag.appendChild(wrapper);

	frag.appendChild(markerSpan(closeMarker));
	return frag;
}

// ── Main renderer ────────────────────────────────────────────────────────────

export function renderInlineNodes(
	nodes: InlineNode[],
	raw: string,
	opts: RenderInlineOptions = {}
): DocumentFragment {
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
				frag.appendChild(renderWrapped(node, raw, 'em', opts));
				break;

			case 'strong':
				frag.appendChild(renderWrapped(node, raw, 'strong', opts));
				break;

			case 'strikethrough':
				frag.appendChild(renderWrapped(node, raw, 's', opts));
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
					const lastChild = children[children.length - 1];
					const openMarker = raw.slice(node.start, children[0].start);
					// Split closeMarker into the closing `]` of the text bracket and the
					// trailing marker (`(url)` for inline form, `[label]` / `[]` for
					// reference forms). Reference forms get a separate `md-ref-label`
					// class so CSS can dim them more aggressively than inline markers.
					const closingTextBracket =
						raw[lastChild.end] === ']' ? raw.slice(lastChild.end, lastChild.end + 1) : '';
					const trailingMarker = raw.slice(lastChild.end + (closingTextBracket ? 1 : 0), node.end);

					frag.appendChild(markerSpan(openMarker));
					const resolvedHref =
						node.url !== undefined ? (opts.resolveLinkUrl ?? ((u) => u))(node.url) : undefined;
					const hrefOk = resolvedHref !== undefined && isAllowedHrefScheme(resolvedHref);
					const linkEl = document.createElement(hrefOk ? 'a' : 'span');
					linkEl.className = hrefOk ? 'md-link-content' : 'md-link-content md-link-blocked';
					if (hrefOk) {
						linkEl.setAttribute('href', resolvedHref!);
						if (node.title !== undefined) linkEl.setAttribute('title', node.title);
					}
					linkEl.appendChild(renderInlineNodes(children, raw, opts));
					frag.appendChild(linkEl);
					if (closingTextBracket) {
						frag.appendChild(markerSpan(closingTextBracket));
					}
					if (trailingMarker) {
						if (node.label !== undefined) {
							const span = document.createElement('span');
							span.className = 'md-ref-label';
							span.textContent = trailingMarker;
							frag.appendChild(span);
						} else {
							frag.appendChild(markerSpan(trailingMarker));
						}
					}
				} else {
					// Empty link text: [](url)
					const mid = raw.indexOf(']', node.start);
					frag.appendChild(markerSpan(raw.slice(node.start, mid !== -1 ? mid : node.end)));
					if (mid !== -1) frag.appendChild(markerSpan(raw.slice(mid, node.end)));
				}
				break;
			}

			case 'image': {
				const renderWidgets = opts.renderImagesAsWidgets ?? true;
				const resolveUrl = opts.resolveImageUrl ?? ((u) => u);
				if (renderWidgets && opts.buildImageWidget) {
					frag.appendChild(
						opts.buildImageWidget(node, raw, {
							resolveImageUrl: resolveUrl,
							imageLoadPolicy: opts.imageLoadPolicy ?? 'auto'
						})
					);
				} else {
					const altText = node.alt ?? '';
					const altStart = node.start + 2;
					const altEnd = altStart + altText.length;
					frag.appendChild(markerSpan(raw.slice(node.start, altStart)));
					frag.appendChild(document.createTextNode(altText));
					frag.appendChild(markerSpan(raw.slice(altEnd, node.end)));
				}
				break;
			}

			case 'autolink': {
				const resolved =
					node.url !== undefined ? (opts.resolveLinkUrl ?? ((u) => u))(node.url) : undefined;
				const ok = resolved !== undefined && isAllowedHrefScheme(resolved);
				const el = document.createElement(ok ? 'a' : 'span');
				el.className = ok ? 'md-autolink' : 'md-autolink md-link-blocked';
				if (ok) el.setAttribute('href', resolved!);
				el.textContent = raw.slice(node.start, node.end);
				frag.appendChild(el);
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

			case 'unresolvedReference': {
				const span = document.createElement('span');
				span.className =
					node.refKind === 'image'
						? 'md-unresolved-ref md-unresolved-ref-image'
						: 'md-unresolved-ref';
				span.textContent = raw.slice(node.start, node.end);
				frag.appendChild(span);
				break;
			}

			case 'rawHtml': {
				const widget = buildCoreInlineWidget(node, raw, opts.buildPortalWidget);
				if (widget) {
					frag.appendChild(widget);
				} else {
					const span = document.createElement('span');
					span.className = 'md-raw-html';
					span.textContent = raw.slice(node.start, node.end);
					frag.appendChild(span);
				}
				break;
			}

			default: {
				// Registered plugin widget kinds render through the registry; anything
				// still unrecognized falls back to its raw source, mirroring the
				// unknown-block fallback so every byte round-trips.
				const widget = buildCoreInlineWidget(node, raw, opts.buildPortalWidget);
				if (widget) {
					frag.appendChild(widget);
					break;
				}
				const span = document.createElement('span');
				span.className = 'md-unknown-inline';
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
 *
 * Model-layer lookup: walks the parsed inline tree, touches no DOM. The DOM-layer
 * counterpart is `cursor/widget-offset.ts` `findDomTextOffsetTarget`, which maps
 * a walk-space offset to a live `(node, offset)` DOM position.
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
