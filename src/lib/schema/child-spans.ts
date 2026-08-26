/**
 * Byte offsets of each child's rendered region inside its container's own `raw`, so a typing
 * rewrite splices one region instead of re-joining every child (O(1) reads through the `$state`
 * proxy rather than O(children)). Bookkeeping, never bytes: nothing serializes or renders it, and
 * a span the invalidation seams missed fails the region check below and falls back to the full
 * rebuild. A `Uint32Array` on purpose — Svelte proxies plain arrays, and the shift would mint a
 * source per element.
 */

import type { CstNode } from '../core/nodes';
import { concatChildren } from '../core/serializer';
import { splitLines } from '../core/lines';

/** The child a rebuild is re-rendering, and the bytes its region currently holds. */
export interface ChildRawChange {
	index: number;
	previousRaw: string;
}

/** A strip container's per-line transform; `first` marks the container's own opening line. */
export type LinePrefix = (text: string, first: boolean) => string;

/** One child's contribution to its container's raw. */
type RenderChild = (text: string, first: boolean) => string;

/** Drop the spans a children-shape change invalidated; the next full rebuild reseeds them. */
export function dropChildSpans(node: CstNode): void {
	// Tested, not assigned blind: a bare write would mint the field on every node it passes.
	if (node.childSpans) node.childSpans = undefined;
}

// ── Rebuilds ─────────────────────────────────────────────────────────────────

/** A container whose raw is its children's bytes joined (list). */
export function rebuildConcatRaw(node: CstNode, changed?: ChildRawChange): void {
	const children = node.children!;
	if (changed && spliceChildRegion(node, children, changed, renderVerbatim)) return;

	const spans = new Uint32Array(children.length * 2);
	let out = '';
	for (let i = 0; i < children.length; i++) {
		// One indexed read per child: the array is a `$state` proxy and each one is a trap.
		const child = children[i];
		spans[i * 2] = out.length;
		out += child.leadingTrivia + child.raw;
		spans[i * 2 + 1] = out.length;
	}
	node.raw = out;
	node.childSpans = spans;
}

/**
 * A container whose raw re-prefixes every line of its body (blockquote, list item). `innerPrefix`
 * is unread: these kinds open their body on their own first line, so no parse fills it (G1.5).
 */
export function rebuildStripRaw(node: CstNode, prefix: LinePrefix, changed?: ChildRawChange): void {
	const children = node.children!;
	const render: RenderChild = (text, first) => renderPrefixed(text, prefix, first);
	if (changed && spliceChildRegion(node, children, changed, render)) return;

	const spans = new Uint32Array(children.length * 2);
	let out = '';
	// A child ending mid-line shares that line with whatever follows, so the two would be
	// prefixed separately: the whole-body rebuild is the only faithful answer for that shape.
	let openLine = false;
	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		const text = child.leadingTrivia + child.raw;
		if (openLine && text !== '') return rebuildWholeStrip(node, prefix);
		spans[i * 2] = out.length;
		out += render(text, out.length === 0);
		spans[i * 2 + 1] = out.length;
		if (text !== '') openLine = !text.endsWith('\n');
	}

	const suffix = node.innerSuffix ?? '';
	if (suffix !== '') {
		if (openLine) return rebuildWholeStrip(node, prefix);
		out += render(suffix, out.length === 0);
	}
	node.raw = out;
	node.childSpans = spans;
}

function rebuildWholeStrip(node: CstNode, prefix: LinePrefix): void {
	node.childSpans = undefined;
	node.raw = renderPrefixed(
		concatChildren(node.children!) + (node.innerSuffix ?? ''),
		prefix,
		true
	);
}

// ── Rendering ────────────────────────────────────────────────────────────────

const renderVerbatim: RenderChild = (text) => text;

function renderPrefixed(text: string, prefix: LinePrefix, first: boolean): string {
	if (text === '') return '';
	let out = '';
	const lines = splitLines(text);
	for (let i = 0; i < lines.length; i++) {
		out += prefix(lines[i].text, first && i === 0) + lines[i].lineEnding;
	}
	return out;
}

// ── The splice ───────────────────────────────────────────────────────────────

/**
 * Rewrite one child's region in place, or decline so the caller reseeds. Declines cover every
 * way the spans can have stopped describing `raw`: the region check is what turns a span the
 * invalidation seams missed into a slower rebuild instead of a corruption.
 */
function spliceChildRegion(
	node: CstNode,
	children: CstNode[],
	changed: ChildRawChange,
	render: RenderChild
): boolean {
	const spans = node.childSpans;
	if (!spans || spans.length !== children.length * 2) return false;

	const child = children[changed.index];
	if (!child) return false;
	const start = spans[changed.index * 2];
	const end = spans[changed.index * 2 + 1];
	const raw = node.raw;
	if (start > end || end > raw.length) return false;

	const first = start === 0;
	const trivia = child.leadingTrivia;
	if (raw.slice(start, end) !== render(trivia + changed.previousRaw, first)) return false;

	const rendered = render(trivia + child.raw, first);
	if (end < raw.length) {
		// Nothing may reach across the regions that follow: a body running past its own last
		// line ending would share it, and an emptied opening region hands line 0 to the next child.
		if (rendered !== '' && !rendered.endsWith('\n')) return false;
		if (first && end > start !== (rendered !== '')) return false;
	}

	node.raw = raw.slice(0, start) + rendered + raw.slice(end);
	const delta = rendered.length - (end - start);
	if (delta !== 0) {
		spans[changed.index * 2 + 1] = end + delta;
		for (let i = changed.index * 2 + 2; i < spans.length; i++) spans[i] += delta;
	}
	return true;
}
