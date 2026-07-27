/**
 * DOM renderer for InlineNode trees. Over a widget-free range, textContent of
 * the returned fragment equals raw.slice — every character in raw has a
 * corresponding text node.
 *
 * Atomic widgets break that by design: a widget contributes its OWN text (an
 * entity's decoded glyph, one character for six raw bytes) or none at all (an
 * image, a `<br>`), carrying its source bytes on `data-source-*` instead. So a
 * raw offset is recovered only through the shared walk (cursor/widget-offset.ts),
 * never by counting textContent. The property test states the scoped invariant
 * both ways (G2.4).
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
	/**
	 * Stamp each construct's marker spans (and ref labels) with the construct's raw
	 * range as `data-construct-start`/`-end`, so preview-inline's construct-reveal
	 * trigger can address them per construct. Attributes only — textContent is
	 * untouched, so the offset walk is unaffected. Off by default: the default DOM
	 * stays byte-identical outside preview-inline.
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

// The verbatim-source fallback for inline kinds that render no widget: a classed span
// whose text is the node's own bytes, so every character still round-trips.
function sourceSpan(raw: string, node: InlineNode, className: string): HTMLSpanElement {
	const span = document.createElement('span');
	span.className = className;
	span.textContent = raw.slice(node.start, node.end);
	return span;
}

// One url-policy choke point for both href sinks (link, autolink): resolve through
// the caller's rewrite, then gate on the scheme allowlist. Returns the safe href, or
// undefined when absent or blocked — the caller reads that as "render an inert span".
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
	// Fence length is read back off `raw`, not inferred from `node.text`'s length:
	// the rendered bytes must reconstruct `raw` exactly, so every span this function
	// emits is a slice of it rather than a parsed field that happens to agree.
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
 * One construct's pending child render. Children accumulate in a detached fragment
 * and `close` assembles the construct from it — wrapper, then closing markers —
 * when the frame drains. Assembly stays bottom-up: appending into a fragment that
 * is still detached keeps each insertion's ancestor bookkeeping O(1) rather than
 * O(depth). Nothing else can reach the construct's container in between, since the
 * frame sits on top of the stack until it drains, so the emitted order is source
 * order.
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
		// No children — entire interior is markers; split in half.
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

// Markers come from raw.slice; never reconstruct from parsed fields (the parsed
// url/title can differ from the source bytes).
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
	// Split the close marker into the closing `]` of the text bracket and the
	// trailing marker (`(url)` for inline form, `[label]` / `[]` for reference
	// forms). Reference forms get a separate `md-ref-label` class so CSS can dim
	// them more aggressively than inline markers.
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

// ── Images ───────────────────────────────────────────────────────────────────

/**
 * The widget-free image path — a kind whose descriptor declines image widgets
 * (table cells), or a consumer that injects no builder. Renders source bytes with
 * the alt text left undimmed, so a reading-mode marker collapse leaves the alt.
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
	// `alt` locates the split and never supplies text (openLink's rule), and only where
	// it is literally those bytes: a minted image's markers need not be the two a GFM
	// image's are. Unlocatable → unmarked source, since markers collapse in reading mode
	// and a construct nobody can decompose would collapse whole.
	if (altEnd > node.end || !raw.startsWith(altText, altStart)) {
		container.appendChild(document.createTextNode(raw.slice(node.start, node.end)));
		return;
	}
	container.appendChild(tagConstruct(markerSpan(raw.slice(node.start, altStart)), node, opts));
	container.appendChild(document.createTextNode(raw.slice(altStart, altEnd)));
	container.appendChild(tagConstruct(markerSpan(raw.slice(altEnd, node.end)), node, opts));
}

// ── Main renderer ────────────────────────────────────────────────────────────

/**
 * Append one node's DOM to `container`, returning the frame for its children when
 * it has any — the driver owns the descent so nesting depth costs no call stack.
 */
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
			// Text node carries the line ending (LF or CRLF) so textContent equals
			// raw byte-for-byte; <br> would diverge across browsers.
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

		case 'autolink': {
			const href = resolveHref(opts, node.url);
			const el = document.createElement(href !== undefined ? 'a' : 'span');
			el.className = href !== undefined ? 'md-autolink' : 'md-autolink md-link-blocked';
			if (href !== undefined) el.setAttribute('href', href);
			el.textContent = raw.slice(node.start, node.end);
			container.appendChild(el);
			return null;
		}

		case 'escape':
			container.appendChild(markerSpan(raw[node.start]));
			container.appendChild(document.createTextNode(raw.slice(node.start + 1, node.end)));
			return null;

		case 'entityReference':
			// A visibly-rendering reference builds an atomic widget of its decoded
			// glyph; an invisible one (whitespace/control decoding) is not a widget,
			// so buildCoreInlineWidget returns null and it keeps its literal-source span.
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
			// Registered plugin widget kinds render through the registry; anything
			// still unrecognized falls back to its raw source, mirroring the
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
	// Iterative: inline nesting depth is input-controlled (each `*`-run pair nests one
	// level), so a per-level recursion overflows the call stack on a large paragraph —
	// and the RangeError strands the block in the failed-block fallback, which cannot
	// heal. The sibling scan (`scanChildren`, inline/scan/autolinks.ts) is iterative
	// for the same reason.
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
	// Iterative for the reason the renderer is: nesting depth is input-controlled.
	// Descent never backtracks — the first containing sibling wins its level — so the
	// answer is the deepest containing node, or the last one when descent finds none.
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
