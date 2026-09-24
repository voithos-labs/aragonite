/**
 * Between a byte offset in a block's `raw` and a caret position in one of its leaves. A caret
 * sits in a leaf, while a fix-up that merges blocks tracks a position as an offset into the
 * merged block's raw; a container's raw re-prefixes its children's lines (`> `, an item's indent),
 * so the offset is mapped line by line. Only a `'strip'` container's layout is known here.
 */

import type { NodeView } from '../core/node-views';
import { displayLength, splitLines, type ParsedLine } from '../core/lines';
import { tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';

export interface LeafPosition {
	/** Child indices from the node down to the leaf; empty when the node is the leaf. */
	path: number[];
	/** Offset into the leaf's raw, within its displayed text. */
	offset: number;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * The leaf and offset `rawOffset` addresses inside `node`, descending through every container on
 * the way. Null when a container on the way is not a strip container, whose bytes this module
 * cannot map to its children.
 */
export function leafAtRawOffset(node: NodeView, rawOffset: number): LeafPosition | null {
	const descriptor = tryGetBlockKindDescriptor(node.kind);
	if (!descriptor?.isContainer || !node.children?.length) {
		return { path: [], offset: Math.min(Math.max(rawOffset, 0), displayLength(node.raw)) };
	}
	if (descriptor.containerContract !== 'strip') return null;

	const inner = bodyOffsetOf(node, rawOffset) - (node.innerPrefix ?? '').length;
	const children = node.children;
	let at = 0;
	for (let i = 0; i < children.length; i++) {
		const start = at + children[i].leadingTrivia.length;
		const end = start + displayLength(children[i].raw);
		if (inner <= end || i === children.length - 1) {
			const leaf = leafAtRawOffset(children[i], Math.max(inner - start, 0));
			return leaf && { path: [i, ...leaf.path], offset: leaf.offset };
		}
		at = start + children[i].raw.length;
	}
	return null;
}

/**
 * The offset into `node`'s raw that the position `offset` in the leaf at `path` sits at: the
 * inverse of {@link leafAtRawOffset}, with the same refusal.
 */
export function rawOffsetOfLeaf(
	node: NodeView,
	path: readonly number[],
	offset: number
): number | null {
	if (path.length === 0) return offset;
	const descriptor = tryGetBlockKindDescriptor(node.kind);
	const children = node.children;
	if (descriptor?.containerContract !== 'strip' || !children?.[path[0]]) return null;

	const inChild = rawOffsetOfLeaf(children[path[0]], path.slice(1), offset);
	if (inChild === null) return null;
	let inner = (node.innerPrefix ?? '').length;
	for (let i = 0; i < path[0]; i++)
		inner += children[i].leadingTrivia.length + children[i].raw.length;
	inner += children[path[0]].leadingTrivia.length + inChild;
	return rawOffsetOfBody(node, inner);
}

// ── Line mapping ─────────────────────────────────────────────────────────────

/**
 * A strip container's raw and its body (`innerPrefix`, the children's bytes, `innerSuffix`) as
 * lines. The body's lines are the raw's last lines, each with some prefix in front (none on a
 * lazy continuation line); any raw line above them is the container's own opener.
 */
interface LineTable {
	raw: ParsedLine[];
	body: ParsedLine[];
	/** How many raw lines stand above the first body line. */
	shift: number;
}

function lineTable(node: NodeView): LineTable {
	const body =
		(node.innerPrefix ?? '') +
		(node.children ?? []).map((child) => child.leadingTrivia + child.raw).join('') +
		(node.innerSuffix ?? '');
	const raw = splitLines(node.raw);
	const bodyLines = splitLines(body);
	return { raw, body: bodyLines, shift: Math.max(raw.length - bodyLines.length, 0) };
}

/** How many bytes the container writes in front of a body line: the raw line's extra length. */
const prefixLength = (raw: ParsedLine, body: ParsedLine): number =>
	Math.max(raw.text.length - body.text.length, 0);

function bodyOffsetOf(node: NodeView, rawOffset: number): number {
	const { raw, body, shift } = lineTable(node);
	const r = lineHolding(raw, rawOffset);
	const b = r - shift;
	if (b < 0 || !body[b]) return b < 0 ? 0 : (body.at(-1)?.end ?? 0);
	const column = Math.min(rawOffset - raw[r].start, raw[r].text.length);
	const inBody = Math.min(Math.max(column - prefixLength(raw[r], body[b]), 0), body[b].text.length);
	return body[b].start + inBody;
}

function rawOffsetOfBody(node: NodeView, bodyOffset: number): number {
	const { raw, body, shift } = lineTable(node);
	const b = lineHolding(body, bodyOffset);
	const r = b + shift;
	if (!raw[r] || !body[b]) return raw.at(-1)?.end ?? 0;
	const column = Math.min(bodyOffset - body[b].start, body[b].text.length);
	return raw[r].start + Math.min(prefixLength(raw[r], body[b]) + column, raw[r].text.length);
}

/** The index of the line `offset` falls on; an offset on a line's ending counts as that line. */
function lineHolding(lines: readonly ParsedLine[], offset: number): number {
	for (let i = 0; i < lines.length; i++) if (offset < lines[i].end) return i;
	return Math.max(lines.length - 1, 0);
}
