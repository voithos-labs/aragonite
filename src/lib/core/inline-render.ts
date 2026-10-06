/**
 * DOM renderer for inline node trees. Over a widget-free range the fragment's textContent equals
 * raw.slice. Widgets break that by design, contributing their own text or none and carrying their
 * source bytes on `data-source-*`, so a raw offset is recovered only through the shared DOM
 * traversal (cursor/widget-offset.ts), never by counting textContent (G2.4). Which of the spans
 * built here a mode leaves on screen is `inline/visibility.ts`.
 */

import type { InlineNode } from './nodes';
import { buildCoreInlineWidget } from './inline/inline-widgets';
import { codeSpanFence } from './inline/scan/code-spans';
import type { GrammarView } from '../schema/block-openers';
import { isAllowedHrefScheme } from './url-policy';
import { firstDisplayLine } from './lines';

// ── Render options ──────────────────────────────────────────────────────────

export type ImageLoadPolicy = 'auto' | 'placeholder';

export interface RenderInlineOptions {
	renderImagesAsWidgets?: boolean;
	resolveImageUrl?: (rawUrl: string) => string;
	/** Render-time href rewrite for links/autolinks (default identity). */
	resolveLinkUrl?: (rawUrl: string) => string;
	/** Whether remote images auto-load (default) or defer to a placeholder. */
	imageLoadPolicy?: ImageLoadPolicy;
	/** Injected by the component layer so `core/` owns no image specifics; absent renders alt-only. */
	buildImageWidget?: (
		node: InlineNode,
		raw: string,
		opts: {
			resolveImageUrl: (rawUrl: string) => string;
			imageLoadPolicy: ImageLoadPolicy;
		}
	) => Node;
	/**
	 * Mounts a `component`-kind widget in the widget shell wrapper. Injected for the same reason
	 * as `buildImageWidget`; absent or null falls the widget back to its raw source.
	 */
	buildPortalWidget?: (node: InlineNode, raw: string) => HTMLElement | null;
	/** The editor's grammar: a widget kind whose plugin it leaves out renders as its source. */
	grammar: GrammarView;
	/** The lines a pending hard break opened past the text (Shift+Enter at a block's end, which
	 *  writes no byte until the next insertion); 0 or absent for none. */
	pendingBreaks?: number;
	/** Write each construct's raw range onto its marker spans as data attributes, for the
	 *  preview-inline reveal. Off by default, so the DOM stays byte-identical elsewhere. */
	tagConstructMarkers?: boolean;
}

// ── Marker helpers ──────────────────────────────────────────────────────────

function markerSpan(text: string): HTMLSpanElement {
	const span = document.createElement('span');
	span.className = 'md-marker';
	span.textContent = text;
	return span;
}

/**
 * A hard break's marker, wrapped in the element the stylesheet draws a return glyph on where the
 * marker's bytes do not show: the wrapper holds no text, so every offset and copy reads the bytes.
 */
function hardBreakMark(marker: HTMLSpanElement): HTMLSpanElement {
	const mark = document.createElement('span');
	mark.className = 'md-hard-break';
	// Trailing spaces are blank even where they paint, so source mode draws the glyph for them too.
	if (marker.textContent?.startsWith(' ')) mark.setAttribute('data-trailing-spaces', '');
	mark.appendChild(marker);
	return mark;
}

function tagConstruct(el: HTMLElement, node: InlineNode, opts: RenderInlineOptions): HTMLElement {
	if (opts.tagConstructMarkers) {
		el.setAttribute('data-construct-start', String(node.start));
		el.setAttribute('data-construct-end', String(node.end));
	}
	return el;
}

// The verbatim-source fallback for kinds that render no widget, so every character round-trips.
function sourceSpan(raw: string, node: InlineNode, className: string): HTMLSpanElement {
	const span = document.createElement('span');
	span.className = className;
	span.textContent = raw.slice(node.start, node.end);
	return span;
}

/** The one href path every DOM sink goes through: a consumer's rewrite, then the scheme allowlist.
 *  Undefined means render inert. */
export function resolveHref(
	opts: Pick<RenderInlineOptions, 'resolveLinkUrl'>,
	url: string | undefined
): string | undefined {
	if (url === undefined) return undefined;
	const resolved = (opts.resolveLinkUrl ?? ((u) => u))(url);
	// A type-violating resolver returning null/undefined degrades to an inert span, never a throw.
	if (typeof resolved !== 'string') return undefined;
	return isAllowedHrefScheme(resolved) ? resolved : undefined;
}

// ── Inline code ─────────────────────────────────────────────────────────────

function renderInlineCode(
	node: InlineNode,
	raw: string,
	opts: RenderInlineOptions
): DocumentFragment {
	const frag = document.createDocumentFragment();
	const fence = codeSpanFence(node);
	const contentStart = node.start + fence;
	const contentEnd = node.end - fence;

	frag.appendChild(tagConstruct(markerSpan(raw.slice(node.start, contentStart)), node, opts));

	const code = document.createElement('code');
	code.className = 'inline-code-content';
	code.textContent = raw.slice(contentStart, contentEnd);
	frag.appendChild(code);

	frag.appendChild(tagConstruct(markerSpan(raw.slice(contentEnd, node.end)), node, opts));
	return frag;
}

// ── Nesting frames ───────────────────────────────────────────────────────────

/** One construct's pending child render, assembled by `close`. Children gather in a detached
 *  fragment, which keeps each insertion O(1) rather than O(depth). */
interface RenderFrame {
	nodes: InlineNode[];
	index: number;
	content: DocumentFragment;
	close: ((content: DocumentFragment) => void) | null;
}

// ── Wrapped spans (emphasis / strong / strikethrough) ───────────────────────

function openWrapped(
	node: InlineNode,
	raw: string,
	tag: string,
	opts: RenderInlineOptions,
	container: Node
): RenderFrame {
	const children = node.children ?? [];

	let openEnd: number;
	let closeStart: number;

	if (children.length > 0) {
		openEnd = children[0].start;
		closeStart = children[children.length - 1].end;
	} else {
		// No children, so the entire interior is markers; split it in half.
		const mid = node.start + Math.floor((node.end - node.start) / 2);
		openEnd = mid;
		closeStart = mid;
	}

	container.appendChild(tagConstruct(markerSpan(raw.slice(node.start, openEnd)), node, opts));
	const wrapper = document.createElement(tag);
	const closeMarker = tagConstruct(markerSpan(raw.slice(closeStart, node.end)), node, opts);

	return {
		nodes: children,
		index: 0,
		content: document.createDocumentFragment(),
		close(content) {
			wrapper.appendChild(content);
			container.appendChild(wrapper);
			container.appendChild(closeMarker);
		}
	};
}

// ── Links ────────────────────────────────────────────────────────────────────

// Markers come from raw.slice, since the parsed url/title can differ from the source bytes. Split
// points clamp to node.end: a plugin-made node need not carry GFM's own link bytes (G2.4).
function openLink(
	node: InlineNode,
	raw: string,
	opts: RenderInlineOptions,
	container: Node
): RenderFrame | null {
	const children = node.children ?? [];
	if (children.length === 0) {
		// Empty link text: [](url)
		const bracket = raw.indexOf(']', node.start);
		const mid = bracket !== -1 && bracket < node.end ? bracket : node.end;
		container.appendChild(tagConstruct(markerSpan(raw.slice(node.start, mid)), node, opts));
		if (mid < node.end) {
			container.appendChild(tagConstruct(markerSpan(raw.slice(mid, node.end)), node, opts));
		}
		return null;
	}

	const lastChild = children[children.length - 1];
	// The close marker splits into the text bracket's `]` and the trailing marker. Reference forms
	// get their own `md-ref-label` class so CSS can style the label as metadata.
	const closingTextBracket =
		lastChild.end < node.end && raw[lastChild.end] === ']'
			? raw.slice(lastChild.end, lastChild.end + 1)
			: '';
	const trailingMarker = raw.slice(lastChild.end + (closingTextBracket ? 1 : 0), node.end);

	container.appendChild(
		tagConstruct(markerSpan(raw.slice(node.start, children[0].start)), node, opts)
	);
	const href = resolveHref(opts, node.url);
	const linkEl = document.createElement(href !== undefined ? 'a' : 'span');
	linkEl.className = href !== undefined ? 'md-link-content' : 'md-link-content md-link-blocked';
	if (href !== undefined) {
		linkEl.setAttribute('href', href);
		// The author's title, else the resolved destination: live mode hides the URL, and hover
		// is the one affordance disclosing where an untitled link actually goes.
		linkEl.setAttribute('title', node.title ?? href);
	}

	const trailing: Node[] = [];
	if (closingTextBracket) {
		trailing.push(tagConstruct(markerSpan(closingTextBracket), node, opts));
	}
	if (trailingMarker) {
		if (node.label !== undefined) {
			const span = document.createElement('span');
			span.className = 'md-ref-label';
			span.textContent = trailingMarker;
			trailing.push(tagConstruct(span, node, opts));
		} else {
			trailing.push(tagConstruct(markerSpan(trailingMarker), node, opts));
		}
	}

	return {
		nodes: children,
		index: 0,
		content: document.createDocumentFragment(),
		close(content) {
			linkEl.appendChild(content);
			container.appendChild(linkEl);
			for (const marker of trailing) container.appendChild(marker);
		}
	};
}

// ── Autolinks ────────────────────────────────────────────────────────────────

/** The angle form's `<`/`>` render as markers the mode CSS can hide. Read off the raw bytes, never
 *  `node.url`, which a bare form may synthesize (`http://`, `mailto:`). */
function appendAutolink(
	node: InlineNode,
	raw: string,
	opts: RenderInlineOptions,
	container: Node
): void {
	const href = resolveHref(opts, node.url);
	const el = document.createElement(href !== undefined ? 'a' : 'span');
	el.className = href !== undefined ? 'md-autolink' : 'md-autolink md-link-blocked';
	if (href !== undefined) el.setAttribute('href', href);

	const isAngleForm = raw[node.start] === '<' && raw[node.end - 1] === '>';
	const textStart = isAngleForm ? node.start + 1 : node.start;
	const textEnd = isAngleForm ? node.end - 1 : node.end;
	el.textContent = raw.slice(textStart, textEnd);

	if (isAngleForm) container.appendChild(markerSpan(raw.slice(node.start, textStart)));
	container.appendChild(el);
	if (isAngleForm) container.appendChild(markerSpan(raw.slice(textEnd, node.end)));
}

// ── Images ───────────────────────────────────────────────────────────────────

/**
 * The widget-free image path (a kind that declines image widgets, or no injected builder).
 * The alt text stays undimmed, so a reading-mode marker collapse leaves it behind.
 */
function appendImageSource(
	node: InlineNode,
	raw: string,
	opts: RenderInlineOptions,
	container: Node
): void {
	const altText = node.alt ?? '';
	const altStart = node.start + 2;
	const altEnd = altStart + altText.length;
	// `alt` only locates the split, and only where it is literally those bytes, since a plugin-made
	// image need not be GFM's; an unlocatable one falls back to unmarked source.
	if (altEnd > node.end || !raw.startsWith(altText, altStart)) {
		container.appendChild(document.createTextNode(raw.slice(node.start, node.end)));
		return;
	}
	container.appendChild(tagConstruct(markerSpan(raw.slice(node.start, altStart)), node, opts));
	container.appendChild(document.createTextNode(raw.slice(altStart, altEnd)));
	container.appendChild(tagConstruct(markerSpan(raw.slice(altEnd, node.end)), node, opts));
}

// ── Main renderer ────────────────────────────────────────────────────────────

/** Returns a frame for the node's children; the driver owns the descent, off the call stack. */
function renderNode(
	node: InlineNode,
	raw: string,
	opts: RenderInlineOptions,
	container: Node
): RenderFrame | null {
	switch (node.kind) {
		case 'text':
			container.appendChild(document.createTextNode(raw.slice(node.start, node.end)));
			return null;

		case 'inlineCode':
			container.appendChild(renderInlineCode(node, raw, opts));
			return null;

		case 'emphasis':
			return openWrapped(node, raw, 'em', opts, container);

		case 'strong':
			return openWrapped(node, raw, 'strong', opts, container);

		case 'strikethrough':
			return openWrapped(node, raw, 's', opts, container);

		case 'hardLineBreak': {
			// A text node carries the line ending so textContent equals raw byte-for-byte;
			// a `<br>` would diverge across browsers.
			const breakRaw = raw.slice(node.start, node.end);
			// The marker is the break's first line; a node with no line ending is all marker.
			const lineEndingStart = firstDisplayLine(breakRaw).text.length;
			if (lineEndingStart > 0) {
				container.appendChild(hardBreakMark(markerSpan(breakRaw.slice(0, lineEndingStart))));
			}
			container.appendChild(document.createTextNode(breakRaw.slice(lineEndingStart)));
			return null;
		}

		case 'link':
			return openLink(node, raw, opts, container);

		case 'image': {
			const renderWidgets = opts.renderImagesAsWidgets ?? true;
			if (renderWidgets && opts.buildImageWidget) {
				container.appendChild(
					opts.buildImageWidget(node, raw, {
						resolveImageUrl: opts.resolveImageUrl ?? ((u) => u),
						imageLoadPolicy: opts.imageLoadPolicy ?? 'auto'
					})
				);
			} else {
				appendImageSource(node, raw, opts, container);
			}
			return null;
		}

		case 'autolink':
			appendAutolink(node, raw, opts, container);
			return null;

		case 'escape':
			container.appendChild(markerSpan(raw[node.start]));
			container.appendChild(document.createTextNode(raw.slice(node.start + 1, node.end)));
			return null;

		case 'unresolvedReference':
			container.appendChild(
				sourceSpan(
					raw,
					node,
					node.refKind === 'image'
						? 'md-unresolved-ref md-unresolved-ref-image'
						: 'md-unresolved-ref'
				)
			);
			return null;

		case 'entityReference':
		case 'rawHtml':
		default:
			// An invisible entity renders no widget and keeps its literal-source span, as does any
			// kind the registry does not own, so every byte round-trips.
			container.appendChild(
				buildCoreInlineWidget(node, raw, opts.buildPortalWidget, opts.grammar) ??
					sourceSpan(
						raw,
						node,
						node.kind === 'entityReference'
							? 'md-entity'
							: node.kind === 'rawHtml'
								? 'md-raw-html'
								: 'md-unknown-inline'
					)
			);
			return null;
	}
}

export function renderInlineNodes(
	nodes: InlineNode[],
	raw: string,
	opts: RenderInlineOptions
): DocumentFragment {
	// Iterative: nesting depth is input-controlled, so per-level recursion overflows the stack and
	// strands the block in the unhealable fallback. `scanChildren` is iterative for the same reason.
	const root: RenderFrame = {
		nodes,
		index: 0,
		content: document.createDocumentFragment(),
		close: null
	};
	const stack: RenderFrame[] = [root];
	while (stack.length > 0) {
		const frame = stack[stack.length - 1];
		if (frame.index === frame.nodes.length) {
			stack.pop();
			frame.close?.(frame.content);
			continue;
		}
		const child = renderNode(frame.nodes[frame.index++], raw, opts, frame.content);
		if (child !== null) stack.push(child);
	}
	paintPendingBreak(opts.pendingBreaks ?? 0, root.content);
	return root.content;
}

/** The first thing a pending hard break draws, where a closing run on the text's line goes before. */
export const PENDING_BREAK_START = '.md-hard-break[data-pending-break]';

/** Each line a pending break opened: a return glyph and a `br` anchor, then one more anchor the
 *  caret sits before. None of them holds text, so the DOM read and every offset skip them. */
function paintPendingBreak(lines: number, frag: DocumentFragment): void {
	if (lines === 0) return;
	const anchor = () => {
		const br = document.createElement('br');
		br.dataset.caretAnchor = 'break';
		return br;
	};
	for (let i = 0; i < lines; i++) {
		const glyph = document.createElement('span');
		glyph.className = 'md-hard-break';
		glyph.setAttribute('data-pending-break', '');
		frag.append(glyph, anchor());
	}
	frag.appendChild(anchor());
}

// ── Cursor mapping ───────────────────────────────────────────────────────────

export interface OffsetResult {
	node: InlineNode;
	localOffset: number;
}

/** The leaf containing `offset`, preferring the right node at a boundary; `offset === end` matches
 *  only the last node. The DOM side is `findDomTextOffsetTarget` in `cursor/widget-offset.ts`. */
export function findNodeAtOffset(nodes: InlineNode[], offset: number): OffsetResult | null {
	// Descent never backtracks, the first containing sibling winning its level, so the answer is
	// the deepest containing node.
	let level = nodes;
	let found: OffsetResult | null = null;
	for (;;) {
		const node = containingNode(level, offset);
		if (node === null) return found;
		found = { node, localOffset: offset - node.start };
		if (node.children === undefined || node.children.length === 0) return found;
		level = node.children;
	}
}

/** First node covering `offset`; only the last node claims its own `end`. */
function containingNode(nodes: InlineNode[], offset: number): InlineNode | null {
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		const isLast = i === nodes.length - 1;
		if (offset >= node.start && (offset < node.end || (isLast && offset === node.end))) return node;
	}
	return null;
}
