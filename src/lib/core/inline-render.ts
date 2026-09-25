/**
 * DOM renderer for inline node trees. Over a widget-free range the fragment's textContent equals
 * raw.slice. Widgets break that by design, contributing their own text or none and carrying their
 * source bytes on `data-source-*`, so a raw offset is recovered only through the shared DOM
 * traversal (cursor/widget-offset.ts), never by counting textContent (G2.4). Which of the spans
 * built here a mode leaves on screen is `inline/visibility.ts`.
 */

import type { InlineNode } from './nodes';
import { buildCoreInlineWidget } from './inline/inline-widgets';
import type { GrammarView } from '../schema/block-openers';
import { isAllowedHrefScheme } from './url-policy';
import { displayLines, trimTrailingLineEnding } from './lines';

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
	/**
	 * Render a lone backslash ending the display as the hard break it is about to become: the
	 * byte as a (hidden) marker plus two `br` anchors so the caret has a second line to sit on.
	 * Only for a mode that hides markers; the DOM stays byte-identical elsewhere.
	 */
	pendingBreakSeat?: boolean;
	/**
	 * Write the construct's raw range onto its marker spans as data attributes, so preview-inline
	 * can find the spans to reveal. Attributes only, leaving textContent and the offset traversal
	 * untouched. Off by default so the DOM stays byte-identical outside preview-inline.
	 */
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

/** The one href path every DOM sink goes through: a consumer's rewrite, then the scheme allowlist;
 *  undefined means render inert. Exported because the link card's Open button hands over a
 *  user-typed URL. */
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
	// Slices of raw, the opening fence capped at half the node, so a plugin-created node over
	// unfenced bytes still emits each byte exactly once.
	const fenceLimit = node.start + Math.floor((node.end - node.start) / 2);
	let contentStart = node.start;
	while (contentStart < fenceLimit && raw[contentStart] === '`') contentStart++;
	const contentEnd = node.end - (contentStart - node.start);

	frag.appendChild(tagConstruct(markerSpan(raw.slice(node.start, contentStart)), node, opts));

	const code = document.createElement('code');
	code.className = 'inline-code-content';
	code.textContent = raw.slice(contentStart, contentEnd);
	frag.appendChild(code);

	frag.appendChild(tagConstruct(markerSpan(raw.slice(contentEnd, node.end)), node, opts));
	return frag;
}

// ── Nesting frames ───────────────────────────────────────────────────────────

/**
 * One construct's pending child render, assembled by `close` when the frame is done. Children
 * accumulate in a detached fragment, which keeps each insertion's ancestor bookkeeping O(1)
 * rather than O(depth). Emitted order is source order: the frame owns the top of the stack.
 */
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

// Markers come from raw.slice: the parsed url/title can differ from the source bytes. Every
// split point is clamped to node.end: a plugin-created node need not carry the bytes GFM's own
// link does, and a search running past the node would render the next node's source (G2.4).
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

/**
 * The angle form's `<`/`>` are construct syntax, so they render as markers the mode CSS can hide;
 * the bare URL/www/email forms are url text throughout. Read off the raw bytes, never `node.url`:
 * the bare forms may synthesize a url (`http://`, `mailto:`) that is not a slice of the source.
 */
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
	// `alt` locates the split and never supplies text (openLink's rule), and only where it is
	// literally those bytes: a plugin-made image's markers need not be a GFM image's. Unlocatable
	// falls back to unmarked source, since a construct nobody can decompose would collapse whole.
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
			const lineEndingStart = displayLines(breakRaw)[0].text.length;
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
			// An invisible entity is not a widget, so the builder returns null and it keeps its
			// literal-source span; anything the registry does not claim falls back the same way,
			// mirroring the unknown-block fallback so every byte round-trips.
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
	if (opts.pendingBreakSeat) paintPendingBreak(nodes, raw, root.content);
	return root.content;
}

/**
 * A `\` ending the block is a hard break still waiting for its next line, which the scanner reads
 * as literal text until then; drawn as a hidden marker plus two `br` anchors, the user sees the new
 * line. A `br` adds no textContent, so raw offsets are unaffected.
 */
function paintPendingBreak(nodes: InlineNode[], raw: string, frag: DocumentFragment): void {
	const last = nodes[nodes.length - 1];
	if (!last || last.kind !== 'text' || raw[last.end - 1] !== '\\') return;
	// Only the block's own line ending may follow the backslash.
	if (trimTrailingLineEnding(raw.slice(last.end)) !== '') return;
	const tail = frag.lastChild;
	if (!tail || tail.nodeType !== Node.TEXT_NODE || !tail.textContent?.endsWith('\\')) return;
	if (tail.textContent.length === 1) tail.remove();
	else tail.textContent = tail.textContent.slice(0, -1);
	const marker = markerSpan('\\');
	marker.classList.add('md-break-pending');
	frag.appendChild(marker);
	for (let i = 0; i < 2; i++) {
		const anchor = document.createElement('br');
		anchor.dataset.caretAnchor = 'break';
		frag.appendChild(anchor);
	}
}

// ── Cursor mapping ───────────────────────────────────────────────────────────

export interface OffsetResult {
	node: InlineNode;
	localOffset: number;
}

/**
 * The leaf containing `offset`, preferring the right node at a boundary; `offset === end` only
 * matches the last node. Model-layer, touching no DOM: the DOM counterpart is
 * `findDomTextOffsetTarget` in cursor/widget-offset.ts.
 */
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
