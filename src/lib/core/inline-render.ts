/**
 * DOM renderer for InlineNode trees. Over a widget-free range the fragment's textContent equals
 * raw.slice. Atomic widgets break that by design, contributing their own text or none and
 * carrying source bytes on `data-source-*`, so a raw offset is recovered only through the shared
 * walk (cursor/widget-offset.ts), never by counting textContent. Stated both ways by G2.4.
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
	 * Mounts a `component`-kind widget in the atomic-island wrapper. Injected for the same reason
	 * as `buildImageWidget`; absent or null falls the widget back to its raw source.
	 */
	buildPortalWidget?: (node: InlineNode, raw: string) => HTMLElement | null;
	/**
	 * Stamp marker spans with the construct's raw range, so preview-inline's reveal trigger can
	 * address them. Attributes only, leaving textContent and the offset walk untouched. Off by
	 * default so the DOM stays byte-identical outside preview-inline.
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

// The one url-policy choke point for both href sinks. Undefined means absent or blocked, which
// the caller reads as "render an inert span".
function resolveHref(opts: RenderInlineOptions, url: string | undefined): string | undefined {
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
	// Read back off `raw`, not inferred from `node.text`: every span emitted here must be a slice
	// of raw rather than a parsed field that happens to agree.
	let contentStart = node.start;
	while (contentStart < node.end && raw[contentStart] === '`') contentStart++;
	const tickLen = contentStart - node.start;
	const ticks = raw.slice(node.start, contentStart);
	const content = raw.slice(contentStart, node.end - tickLen);

	frag.appendChild(tagConstruct(markerSpan(ticks), node, opts));

	const code = document.createElement('code');
	code.className = 'inline-code-content';
	code.textContent = content;
	frag.appendChild(code);

	frag.appendChild(tagConstruct(markerSpan(ticks), node, opts));
	return frag;
}

// ── Nesting frames ───────────────────────────────────────────────────────────

/**
 * One construct's pending child render, assembled by `close` when the frame drains. Children
 * accumulate in a DETACHED fragment, which keeps each insertion's ancestor bookkeeping O(1)
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

// Markers come from raw.slice: the parsed url/title can differ from the source bytes.
function openLink(
	node: InlineNode,
	raw: string,
	opts: RenderInlineOptions,
	container: Node
): RenderFrame | null {
	const children = node.children ?? [];
	if (children.length === 0) {
		// Empty link text: [](url)
		const mid = raw.indexOf(']', node.start);
		container.appendChild(
			tagConstruct(markerSpan(raw.slice(node.start, mid !== -1 ? mid : node.end)), node, opts)
		);
		if (mid !== -1) {
			container.appendChild(tagConstruct(markerSpan(raw.slice(mid, node.end)), node, opts));
		}
		return null;
	}

	const lastChild = children[children.length - 1];
	// The close marker splits into the text bracket's `]` and the trailing marker. Reference forms
	// get their own `md-ref-label` class so CSS can dim them harder than inline markers.
	const closingTextBracket =
		raw[lastChild.end] === ']' ? raw.slice(lastChild.end, lastChild.end + 1) : '';
	const trailingMarker = raw.slice(lastChild.end + (closingTextBracket ? 1 : 0), node.end);

	container.appendChild(
		tagConstruct(markerSpan(raw.slice(node.start, children[0].start)), node, opts)
	);
	const href = resolveHref(opts, node.url);
	const linkEl = document.createElement(href !== undefined ? 'a' : 'span');
	linkEl.className = href !== undefined ? 'md-link-content' : 'md-link-content md-link-blocked';
	if (href !== undefined) {
		linkEl.setAttribute('href', href);
		if (node.title !== undefined) linkEl.setAttribute('title', node.title);
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
 * the bare forms synthesize a url (`http://`, `mailto:`) that is not a slice of the source.
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
	// literally those bytes: a minted image's markers need not be a GFM image's. Unlocatable
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
			const nlIdx = breakRaw.indexOf('\n');
			const lineEndingStart = nlIdx > 0 && breakRaw[nlIdx - 1] === '\r' ? nlIdx - 1 : nlIdx;
			if (lineEndingStart > 0) {
				container.appendChild(markerSpan(breakRaw.slice(0, lineEndingStart)));
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

		case 'entityReference':
			// An invisible reference is not a widget, so the builder returns null and it keeps
			// its literal-source span.
			container.appendChild(
				buildCoreInlineWidget(node, raw, opts.buildPortalWidget) ??
					sourceSpan(raw, node, 'md-entity')
			);
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

		case 'rawHtml':
			container.appendChild(
				buildCoreInlineWidget(node, raw, opts.buildPortalWidget) ??
					sourceSpan(raw, node, 'md-raw-html')
			);
			return null;

		default:
			// Anything the registry does not claim falls back to raw source, mirroring the
			// unknown-block fallback so every byte round-trips.
			container.appendChild(
				buildCoreInlineWidget(node, raw, opts.buildPortalWidget) ??
					sourceSpan(raw, node, 'md-unknown-inline')
			);
			return null;
	}
}

export function renderInlineNodes(
	nodes: InlineNode[],
	raw: string,
	opts: RenderInlineOptions = {}
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
	return root.content;
}

/**
 * The text a reader SEES for `nodes` — the rendered DOM minus every span the marker-hiding modes
 * drop. Lives here because this file decides which bytes become which span (G4.30): a caller
 * re-deriving that drifts from what actually paints, which is the only thing the answer is worth
 * anything as. The reference label is in the list because the same CSS hides it; leaving it in
 * made a resolved reference read as extra characters and declined every rewrite that crossed one.
 */
export function renderedText(
	nodes: InlineNode[],
	raw: string,
	opts: RenderInlineOptions = {}
): string {
	const fragment = renderInlineNodes(nodes, raw, opts);
	// The CSS qualifies its hide with `:not([contenteditable='false'])`; the strip does not need to,
	// because nothing here mints a marker span with that attribute — ambient and widget chrome does,
	// and neither carries a marker class. A marker span that ever gains it owes this line the same
	// qualifier.
	for (const span of fragment.querySelectorAll('.md-marker, .md-ref-label')) span.remove();
	return fragment.textContent ?? '';
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
