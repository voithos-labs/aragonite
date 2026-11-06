/**
 * Maps between a byte offset in a block's `raw` (or a whole document's bytes) and a caret position
 * in one of its leaves, and finds where a container's marker takes its space. A container's raw
 * re-prefixes its children's lines (`> `, an item's indent) or holds them between lines of its own
 * (a fence, a title tag), so the map pairs the container's lines with its children's.
 */

import type { DocumentView, NodeView } from '../core/node-views';
import { displayLength, isWhitespaceChar, splitLines, type ParsedLine } from '../core/lines';
import { tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { reservedChromeKindOf, rowIsOpenerLine } from '../schema/reserved-chrome';

export interface LeafPosition {
	/** Child indices from the node down to the leaf; empty when the node is the leaf. */
	path: number[];
	/** Offset into the leaf's raw, within its displayed text. */
	offset: number;
}

// ── Public API ───────────────────────────────────────────────────────────────

/** The leaf and offset byte `at` of the document's bytes sits at; a byte of a marker, a container's
 *  own line or a line ending goes to the nearest text on its line. Null for an empty document. */
export function leafAtByte(doc: DocumentView, at: number): LeafPosition | null {
	let start = doc.prefix.length;
	const children = doc.children;
	for (let i = 0; i < children.length; i++) {
		const rawStart = start + children[i].leadingTrivia.length;
		const end = rawStart + children[i].raw.length;
		if (at < end || i === children.length - 1) {
			const leaf = leafIn(children[i], at - rawStart, false);
			return leaf && { path: [i, ...leaf.path], offset: leaf.offset };
		}
		start = end;
	}
	return null;
}

/** The byte of the document's bytes that offset `offset` of the leaf at `path` sits at. */
export function byteOfLeaf(
	doc: DocumentView,
	path: readonly number[],
	offset: number
): number | null {
	const children = doc.children;
	if (!children[path[0]]) return null;
	let start = doc.prefix.length;
	for (let i = 0; i < path[0]; i++)
		start += children[i].leadingTrivia.length + children[i].raw.length;
	const top = children[path[0]];
	const inBlock = byteIn(top, path.slice(1), offset, false);
	return inBlock === null ? null : start + top.leadingTrivia.length + inBlock;
}

// The two below keep a strip-only refusal (null past a fenced or grid container's opener line)
// until each caller moves onto the byte mapping above.

/** The leaf and offset `rawOffset` addresses inside `node`. Interim: `caret-target.ts` moves at
 *  stage 2, `node-ops.ts` at stage 3, and paste's callers go at stage 4. */
export function leafAtRawOffset(node: NodeView, rawOffset: number): LeafPosition | null {
	return leafIn(node, rawOffset, true);
}

/** The inverse of {@link leafAtRawOffset}. Interim: `leaf-commit.ts` and the conformance kit move
 *  with the plugin-interface migration. */
export function rawOffsetOfLeaf(
	node: NodeView,
	path: readonly number[],
	offset: number
): number | null {
	return byteIn(node, path, offset, true);
}

// ── Marker space ─────────────────────────────────────────────────────────────

/** Whether a space typed at the start of a child of `container` belongs to its marker: the kind
 *  declares `contentStartSpace`. */
export function takesMarkerSpace(container: NodeView): boolean {
	return tryGetBlockKindDescriptor(container.kind)?.contentStartSpace === 'complete-marker';
}

/** Where the space that finishes `container`'s marker goes in front of child `index` (`>abc`), or
 *  null when the kind takes no such space or the marker already ends in whitespace. */
export function markerSpaceAt(container: NodeView, index: number): number | null {
	if (!takesMarkerSpace(container)) return null;
	const at = rawOffsetOfLeaf(container, [index], 0);
	return at === null || at === 0 || isWhitespaceChar(container.raw[at - 1]) ? null : at;
}

// ── Walks ────────────────────────────────────────────────────────────────────

function leafIn(node: NodeView, rawOffset: number, stripOnly: boolean): LeafPosition | null {
	const descriptor = tryGetBlockKindDescriptor(node.kind);
	const children = node.children;
	if (!descriptor?.isContainer || !children?.length) {
		return { path: [], offset: Math.min(Math.max(rawOffset, 0), displayLength(node.raw)) };
	}
	if (rowIsOpenerLine(node.kind) && rawOffset <= displayLength(children[0].raw)) {
		return { path: [0], offset: Math.max(rawOffset, 0) };
	}
	if (stripOnly && descriptor.containerContract !== 'strip') return null;
	const map = bodyMap(node);
	const inner = map.toBody(rawOffset);
	for (let i = 0; i < children.length; i++) {
		const start = map.childStarts[i];
		if (inner <= start + displayLength(children[i].raw) || i === children.length - 1) {
			const leaf = leafIn(children[i], Math.max(inner - start, 0), stripOnly);
			return leaf && { path: [i, ...leaf.path], offset: leaf.offset };
		}
	}
	return null;
}

function byteIn(
	node: NodeView,
	path: readonly number[],
	offset: number,
	stripOnly: boolean
): number | null {
	if (path.length === 0) return offset;
	if (path.length === 1 && path[0] === 0 && rowIsOpenerLine(node.kind)) return offset;
	const descriptor = tryGetBlockKindDescriptor(node.kind);
	const child = node.children?.[path[0]];
	if (!descriptor?.isContainer || !child) return null;
	if (stripOnly && descriptor.containerContract !== 'strip') return null;
	const inChild = byteIn(child, path.slice(1), offset, stripOnly);
	if (inChild === null) return null;
	const map = bodyMap(node);
	return map.toRaw(map.childStarts[path[0]] + inChild);
}

// ── Line mapping ─────────────────────────────────────────────────────────────

/** A container's body (its children's bytes as they read on their own) against its raw. */
interface BodyMap {
	/** Where each child's own bytes start in the body, past its blank lines. */
	childStarts: number[];
	toBody(rawOffset: number): number;
	toRaw(bodyOffset: number): number;
}

function bodyMap(node: NodeView): BodyMap {
	const children = node.children ?? [];
	const grid = tryGetBlockKindDescriptor(node.kind)?.containerContract === 'grid';
	return grid && children.every((child) => !child.children) ? cellMap(node) : lineMap(node);
}

/** A container whose children sit on its lines behind markers, or verbatim between lines of its
 *  own. A title row goes first in the body, ahead of the inner prefix. */
function lineMap(node: NodeView): BodyMap {
	const children = node.children ?? [];
	const titled = reservedChromeKindOf(node.kind) !== undefined;
	const childStarts: number[] = [];
	let body = '';
	const add = (i: number) => {
		body += children[i].leadingTrivia;
		childStarts[i] = body.length;
		body += children[i].raw;
	};
	if (titled) add(0);
	body += node.innerPrefix ?? '';
	for (let i = titled ? 1 : 0; i < children.length; i++) add(i);
	body += node.innerSuffix ?? '';

	const raw = splitLines(node.raw);
	const bodyLines = splitLines(body);
	// Per raw line, the body line it carries and the column that line's text starts at.
	const paired: ({ line: number; at: number } | null)[] = [];
	const carrier: number[] = [];
	let next = 0;
	for (let r = 0; r < raw.length; r++) {
		const at = next < bodyLines.length ? textColumn(raw[r], bodyLines[next]) : null;
		paired.push(at === null ? null : { line: next, at });
		if (at !== null) carrier[next++] = r;
	}
	return {
		childStarts,
		toBody(rawOffset) {
			const r = lineHolding(raw, rawOffset);
			const pair = paired[r];
			if (!pair) {
				// A line of the container's own reads as the start of the body line after it.
				const after = paired.slice(r + 1).find((p) => p !== null);
				return after ? bodyLines[after.line].start : body.length;
			}
			const line = bodyLines[pair.line];
			const column = Math.min(rawOffset - raw[r].start, raw[r].text.length) - pair.at;
			return line.start + Math.min(Math.max(column, 0), line.text.length);
		},
		toRaw(bodyOffset) {
			const b = lineHolding(bodyLines, bodyOffset);
			const r = carrier[b];
			if (r === undefined) return node.raw.length;
			const column = Math.min(bodyOffset - bodyLines[b].start, bodyLines[b].text.length);
			const at = Math.min(Math.max(paired[r]!.at + column, 0), raw[r].text.length);
			return raw[r].start + at;
		}
	};
}

/** A table row: its cells lie in order inside its one line, the bytes taken as they stand. */
function cellMap(node: NodeView): BodyMap {
	let cursor = 0;
	const childStarts = (node.children ?? []).map((cell) => {
		const found = cell.raw === '' ? -1 : node.raw.indexOf(cell.raw, cursor);
		// An empty or padded cell sits just past the next pipe.
		const start = found >= 0 ? found : Math.min(node.raw.indexOf('|', cursor) + 1, node.raw.length);
		cursor = start + cell.raw.length;
		return start;
	});
	return { childStarts, toBody: (rawOffset) => rawOffset, toRaw: (bodyOffset) => bodyOffset };
}

/** A marker run alone on a line: quote markers, a list marker and its task box, a footnote label. */
const MARKER_ONLY =
	/^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])(?:[ \t]+\[[ xX]\])?[ \t]*|\[\^[^\]\s]+\]:[ \t]*)?$/;

/** Where `body`'s text starts in raw line `raw`, or null when the line carries none of it: its
 *  tail behind a marker, its text behind a marker a tab was cut in, or a title inside tags. */
function textColumn(raw: ParsedLine, body: ParsedLine): number | null {
	if (raw.lineEnding !== body.lineEnding) return null;
	const { text } = body;
	if (text.trim() === '') {
		if (!MARKER_ONLY.test(raw.text)) return null;
		// A blank body line's spaces sit at the end of its marker.
		return raw.text.endsWith(text) ? raw.text.length - text.length : raw.text.length;
	}
	if (raw.text.endsWith(text)) return raw.text.length - text.length;
	const content = text.trimStart();
	const marker = raw.text.slice(0, raw.text.length - content.length);
	if (raw.text.endsWith(content) && MARKER_ONLY.test(marker)) {
		// Negative where the cut tab stands for more spaces than the marker left behind.
		return marker.length - (text.length - content.length);
	}
	const inTags = raw.text.indexOf('>' + text + '<');
	return inTags < 0 ? null : inTags + 1;
}

/** The index of the line `offset` falls on; an offset on a line's ending counts as that line. */
function lineHolding(lines: readonly ParsedLine[], offset: number): number {
	for (let i = 0; i < lines.length; i++) if (offset < lines[i].end) return i;
	return Math.max(lines.length - 1, 0);
}
