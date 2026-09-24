/** Inline parser entry. See docs/design/inline-parsing.md. */

import type { AnyInlineKind, CstNode, InlineNode } from '../nodes';
import type { NodeView } from '../node-views';
import { displayLength } from '../lines';
import { getBlockKindDescriptor } from '../../schema/block-kind-descriptor';
// Registered before any descriptor read, headless of the editor mount. Explicit call: a bare
// side-effect import is tree-shaken from the production build.
import { registerBuiltInDescriptors } from '../../schema/built-in-descriptors';
import type { LinkReferenceResolver } from './link-reference-resolver';
import { defaultGrammarView, type GrammarView } from '../../schema/block-openers';
import { scanInline } from './scan';
import { inlineDescendants } from './walk';
import { recordInlineCompute } from '../../perf/instruments';

registerBuiltInDescriptors();

// ── Content Range ──────────────────────────────────────────────────────────

export interface ContentRange {
	start: number;
	end: number;
}

declare const contentLengthBrand: unique symbol;
/** Raw-offset length of a block's rendered content, built only from its content range: a
 *  DOM-measured length counts as the DOM traversal does and lags the pass rewriting the DOM. */
export type ContentLength = number & { readonly [contentLengthBrand]: true };

/** Content range within a prose block's raw; marker-bearing kinds override via descriptor. */
export function getContentRange(node: NodeView): ContentRange {
	const d = getBlockKindDescriptor(node.kind);
	if (d.getContentRange) return d.getContentRange(node);
	return { start: 0, end: displayLength(node.raw) };
}

/**
 * The bytes a block keeps past its content, before its trailing line ending: structure no mode
 * draws (a setext underline). The block's DOM stops before them, so text read back from it gets
 * them put back before a write, and the caret's reach ends where they start.
 */
export function undrawnSuffix(node: NodeView): string {
	// A kind that is not prose renders its whole display, so nothing past its content is undrawn.
	if (!isProseKind(node.kind)) return '';
	return node.raw.slice(getContentRange(node).end, displayLength(node.raw));
}

/**
 * `text` read back from a block's DOM with its undrawn suffix put back, unless the last line is
 * blank: an underline under nothing would surface as a block of its own, so an emptied title
 * drops it, as an emptied ATX heading gives up its `#`.
 */
export function withUndrawnSuffix(node: NodeView, text: string): string {
	const lastLine = text.slice(text.lastIndexOf('\n') + 1);
	return /^[ \t]*$/.test(lastLine) ? text : text + undrawnSuffix(node);
}

/** The one place a {@link ContentLength} is created. */
export function contentLengthOf(node: NodeView): ContentLength {
	return getContentRange(node).end as ContentLength;
}

export function isProseKind(kind: CstNode['kind']): boolean {
	return getBlockKindDescriptor(kind).supportsInline;
}

/**
 * The bytes an inline construct's delimiters do not cover, or null for a kind that has none: a
 * bare text run, an escape, a pair emptied of content. The inline counterpart of
 * {@link getContentRange}, here rather than beside one caller because the caret bounds, the
 * typing position, deletion and the toggles all need the same answer.
 */
export function constructContentRange(node: InlineNode): ContentRange | null {
	const children = node.children;
	if (children && children.length > 0) {
		return { start: children[0].start, end: children[children.length - 1].end };
	}
	// A code span carries its content as `text` rather than children, and a matched span's two
	// backtick runs are equal, so what the content does not cover splits evenly between them.
	if (node.kind === 'inlineCode' && node.text !== undefined) {
		const fence = (node.end - node.start - node.text.length) / 2;
		if (Number.isInteger(fence) && fence > 0) {
			return { start: node.start + fence, end: node.end - fence };
		}
	}
	return null;
}

/**
 * A prose node's inline tree, pure: no caching, no reactive reads. The render path calls this
 * directly; the caching accessor (inline-cache.ts) calls it on a miss. An editor passes its own
 * grammar, so a plugin it left out claims no bytes.
 */
export function computeInlineContent(
	node: NodeView,
	resolver: LinkReferenceResolver | undefined,
	grammar: GrammarView
): InlineNode[] {
	recordInlineCompute();
	const range = getContentRange(node);
	return parseInline(node.raw, range.start, range.end, resolver, grammar);
}

const readersByGrammar = new WeakMap<GrammarView, (node: NodeView) => InlineNode[]>();

/** One editor's inline parse with no link resolver, the read a plugin gets. One function per
 *  grammar, so a plugin cache keyed on it is shared by every block of that editor. */
export function inlineReaderFor(grammar: GrammarView): (node: NodeView) => InlineNode[] {
	let read = readersByGrammar.get(grammar);
	if (!read) {
		read = (node) => computeInlineContent(node, undefined, grammar);
		readersByGrammar.set(grammar, read);
	}
	return read;
}

// ── Inline Parser ──────────────────────────────────────────────────────────

/**
 * Parse inline content over raw[start, end). Node offsets are absolute into raw, and every byte
 * lands in exactly one node's range. Both bounds are checked, not just typed: a caller the
 * compiler cannot reach that passes only the source would otherwise get one whole-string text
 * node, which is wrong output that looks like a result. With no grammar it reads every installed
 * plugin's syntax.
 */
export function parseInline(
	raw: string,
	start: number,
	end: number,
	resolver?: LinkReferenceResolver,
	grammar?: GrammarView
): InlineNode[] {
	if (!Number.isFinite(start) || !Number.isFinite(end)) {
		throw new TypeError(
			'parseInline requires both scan bounds: to scan a whole string, call parseInline(src, 0, src.length)'
		);
	}
	return scanInline(raw, start, end, resolver, grammar ?? defaultGrammarView);
}

// ── Inline Tree Walks ──────────────────────────────────────────────────────

export { inlineDescendants };

/** Every construct kind anywhere in a parse, at any depth. */
export function constructKinds(nodes: readonly InlineNode[]): Set<AnyInlineKind> {
	const kinds = new Set<AnyInlineKind>();
	for (const node of inlineDescendants(nodes)) if (node.kind !== 'text') kinds.add(node.kind);
	return kinds;
}
