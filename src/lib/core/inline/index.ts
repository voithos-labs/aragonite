/** Inline parser entry. See docs/design/inline-parsing.md. */

import type { AnyInlineKind, CstNode, InlineNode } from '../nodes';
import type { NodeView } from '../node-views';
import { displayLength, firstDisplayLine } from '../lines';
import { getBlockKindDescriptor } from '../../schema/block-kind-descriptor';
// The built-in descriptors register before any read, with or without a mounted editor; the call
// is explicit because a bare side-effect import is tree-shaken from the production build.
import { registerBuiltInDescriptors } from '../../schema/built-in-descriptors';
import type { LinkReferenceResolver } from './link-reference-resolver';
import type { Reading } from '../../schema/reading';
import { defaultGrammarView, type GrammarView } from '../../schema/block-openers';
import { scanInline } from './scan';
import { codeSpanFence } from './scan/code-spans';
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

/** The structure between a block's content and its line ending, like a setext underline: drawn
 *  as a marker after the text, and kept by every edit that keeps the block's head. */
export function structuralSuffix(node: NodeView): string {
	// A kind that is not prose shows its whole display as content.
	if (!isProseKind(node.kind)) return '';
	return node.raw.slice(getContentRange(node).end, displayLength(node.raw));
}

/** The structural suffix's part on the text's own line, an ATX closing run: a line break made
 *  at the text's end goes after it. A setext underline starts on a line of its own. */
export function sameLineSuffix(node: NodeView): string {
	if (!isProseKind(node.kind)) return '';
	return sameLineSuffixOf(node.raw, getContentRange(node).end);
}

/** {@link sameLineSuffix} over a prose block's raw and its content end. */
export function sameLineSuffixOf(raw: string, contentEnd: number): string {
	return firstDisplayLine(raw.slice(contentEnd, displayLength(raw))).text;
}

/** The one place a {@link ContentLength} is created. */
export function contentLengthOf(node: NodeView): ContentLength {
	return getContentRange(node).end as ContentLength;
}

export function isProseKind(kind: CstNode['kind']): boolean {
	return getBlockKindDescriptor(kind).supportsInline;
}

/** The inline counterpart of {@link getContentRange}: the bytes a construct's delimiters do not
 *  cover, or null for one with no content (a text run, an escape, an emptied pair). */
export function constructContentRange(node: InlineNode): ContentRange | null {
	const children = node.children;
	if (children && children.length > 0) {
		return { start: children[0].start, end: children[children.length - 1].end };
	}
	// A code span carries its content as `text` rather than children.
	const fence = node.kind === 'inlineCode' ? codeSpanFence(node) : 0;
	return fence > 0 ? { start: node.start + fence, end: node.end - fence } : null;
}

/** Uncached and free of reactive reads, so the render path can call it directly. An editor
 *  passes its own grammar, so a plugin it left out takes no bytes. */
export function computeInlineContent(
	node: NodeView,
	resolver: LinkReferenceResolver | undefined,
	grammar: GrammarView
): InlineNode[] {
	recordInlineCompute();
	const range = getContentRange(node);
	return readInline(node.raw, range.start, range.end, resolver, grammar);
}

type InlineReader = (node: NodeView) => InlineNode[];

const readersByReading = new WeakMap<Reading, { epoch: number; read: InlineReader }>();

/** The inline parse a plugin gets: this editor's grammar and the document's definitions as they
 *  stand at each call. A new function per definitions change, so a cache keyed on it refreshes. */
export function inlineReaderFor(reading: Reading): InlineReader {
	const epoch = reading.resolverEpoch;
	const held = readersByReading.get(reading);
	if (held?.epoch === epoch) return held.read;
	const read: InlineReader = (node) =>
		computeInlineContent(node, reading.resolver, reading.grammar);
	readersByReading.set(reading, { epoch, read });
	return read;
}

// ── Inline Parser ──────────────────────────────────────────────────────────

/** Node offsets are absolute into raw, and each byte of raw[start, end) lands in exactly one node.
 *  With no grammar it reads every installed plugin's syntax; the editor uses {@link readInline}. */
export function parseInline(
	raw: string,
	start: number,
	end: number,
	resolver?: LinkReferenceResolver,
	grammar?: GrammarView
): InlineNode[] {
	return readInline(raw, start, end, resolver, grammar ?? defaultGrammarView);
}

/** Both bounds are checked at runtime: a caller outside the type checker that passes only the
 *  source would get one whole-string text node, wrong output that looks like a result. */
export function readInline(
	raw: string,
	start: number,
	end: number,
	resolver: LinkReferenceResolver | undefined,
	grammar: GrammarView
): InlineNode[] {
	if (!Number.isFinite(start) || !Number.isFinite(end)) {
		throw new TypeError(
			'parseInline requires both scan bounds: to scan a whole string, call parseInline(src, 0, src.length)'
		);
	}
	return scanInline(raw, start, end, resolver, grammar);
}

// ── Inline Tree Walks ──────────────────────────────────────────────────────

export { inlineDescendants };

/** Every construct kind anywhere in a parse, at any depth. */
export function constructKinds(nodes: readonly InlineNode[]): Set<AnyInlineKind> {
	const kinds = new Set<AnyInlineKind>();
	for (const node of inlineDescendants(nodes)) if (node.kind !== 'text') kinds.add(node.kind);
	return kinds;
}
