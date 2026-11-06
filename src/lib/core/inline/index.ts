/** Inline parser entry. See docs/design/inline-parsing.md. */

import type { AnyInlineKind, CstNode, InlineNode } from '../nodes';
import type { NodeView } from '../node-views';
import { displayLength, firstDisplayLine, type LineEnding } from '../lines';
import { getBlockKindDescriptor } from '../../schema/block-kind-descriptor';
// The built-in descriptors register before any read, with or without a mounted editor; the call
// is explicit because a bare side-effect import is tree-shaken from the production build.
import { registerBuiltInDescriptors } from '../../schema/built-in-descriptors';
import type { Reading } from '../../schema/reading';
import { type GrammarView } from '../../schema/block-openers';
import { defaultGrammarView } from '../../schema/editor-grammar';
import { readInline } from './scan';
import { codeFenceWidth } from './scan/code-span';
import type { LinkReferenceResolver } from './scan/definitions';
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

/** `text` broken at `at`: a backslash, `suffix` (a heading's closing run, at or past `at`), then
 *  `breaks` line endings, a lone backslash between each two. `lineStart` is where the rest begins. */
export function withHardBreak(
	text: string,
	at: number,
	suffix: ContentRange,
	ending: LineEnding,
	breaks = 1
): { text: string; lineStart: number } {
	const lines = ending + ('\\' + ending).repeat(breaks - 1);
	const head = text.slice(0, at) + '\\' + text.slice(suffix.start, suffix.end) + lines;
	return {
		text: head + text.slice(at, suffix.start) + text.slice(suffix.end),
		lineStart: head.length
	};
}

/** {@link withHardBreak} taken back off a text that ends on an empty line: the text before the
 *  break and how many lines it opened, or null when no backslash break leads into that line. */
export function openLinesAtEnd(text: string): { text: string; lines: number } | null {
	let at = text.length - endingLengthBefore(text, text.length);
	if (at === text.length) return null;
	let lines = 1;
	// Each line above the empty one holding a lone backslash is one more open line.
	while (text[at - 1] === '\\' && endingLengthBefore(text, at - 1) > 0) {
		at -= 1 + endingLengthBefore(text, at - 1);
		lines++;
	}
	let run = 0;
	while (text[at - 1 - run] === '\\') run++;
	// An even run is escaped backslashes, which break nothing.
	if (run % 2 === 0) return null;
	return { text: text.slice(0, at - 1), lines };
}

function endingLengthBefore(text: string, at: number): number {
	if (text[at - 1] !== '\n') return 0;
	return text[at - 2] === '\r' ? 2 : 1;
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
	// An autolink's content is the URL it shows, inside the angle form's brackets.
	if (node.kind === 'autolink') {
		return node.angle
			? { start: node.start + 1, end: node.end - 1 }
			: { start: node.start, end: node.end };
	}
	// A code span carries its content as `text` rather than children.
	const fence = node.kind === 'inlineCode' ? codeFenceWidth(node) : 0;
	return fence > 0 ? { start: node.start + fence, end: node.end - fence } : null;
}

/** Whether a cut or an insertion at `offset` lands inside `node`: its content, bounds included,
 *  or the strict interior of a construct with no delimiters of its own (a bare URL, an escape). */
export function constructHoldsOffset(node: InlineNode, offset: number): boolean {
	if (node.kind === 'text') return false;
	const content = constructContentRange(node);
	const delimited = content && (content.start > node.start || content.end < node.end);
	return delimited
		? offset >= content.start && offset <= content.end
		: offset > node.start && offset < node.end;
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

export { readInline };

// ── Inline Tree Walks ──────────────────────────────────────────────────────

export { inlineDescendants };

/** Every construct kind anywhere in a parse, at any depth. */
export function constructKinds(nodes: readonly InlineNode[]): Set<AnyInlineKind> {
	const kinds = new Set<AnyInlineKind>();
	for (const node of inlineDescendants(nodes)) if (node.kind !== 'text') kinds.add(node.kind);
	return kinds;
}
