/**
 * Maps between a byte offset in a block's `raw` (or a whole document's bytes) and a caret position
 * in one of its leaves, and finds where a container's marker takes its space. A container's raw
 * re-prefixes its children's lines (`> `, an item's indent) or holds them between lines of its own
 * (a fence, a title tag), so the map pairs the container's lines with its children's.
 */

import type { DocumentView, NodeView } from '../core/node-views';
import {
	displayLength,
	isBlankText,
	isWhitespaceChar,
	splitLines,
	type ParsedLine
} from '../core/lines';
import { isGridKind, tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';
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
	return documentByteMap(doc).leafAt(at);
}

/** The byte of the document's bytes that offset `offset` of the leaf at `path` sits at. */
export function byteOfLeaf(
	doc: DocumentView,
	path: readonly number[],
	offset: number
): number | null {
	return documentByteMap(doc).byteOf(path, offset);
}

/** One document's byte map, each container's lines paired once for the map's life, so a caller
 *  asking many positions of one unchanged document pays for each container once. */
export interface DocumentByteMap {
	leafAt(at: number): LeafPosition | null;
	/** The byte offset `offset` of the block at `path` sits at, a leaf or a container. */
	byteOf(path: readonly number[], offset: number): number | null;
	/** The map `node`'s lines are paired in, kept for the map's life; null for a block read as a leaf. */
	containerMap(node: NodeView): ContainerMap | null;
}

export interface ContainerLine {
	start: number;
	/** Where the container's marker on the line ends: `start` on a line with none, `end` on a line
	 *  that carries none of its children (an opening or closing line, a title tag line). */
	markerEnd: number;
	/** Past the line's ending. */
	end: number;
	own: boolean;
}

export function documentByteMap(doc: DocumentView): DocumentByteMap {
	const maps = new Map<NodeView, ContainerMap>();
	const mapOf = (node: NodeView): ContainerMap => {
		let map = maps.get(node);
		if (!map) maps.set(node, (map = bodyMap(node)));
		return map;
	};
	const tops = doc.children;
	const rawStarts: number[] = [];
	let start = doc.prefix.length;
	for (const top of tops) {
		rawStarts.push(start + top.leadingTrivia.length);
		start += top.leadingTrivia.length + top.raw.length;
	}
	return {
		leafAt(at) {
			if (tops.length === 0) return null;
			// The first block whose bytes end past `at`, or the last.
			let lo = 0;
			let hi = tops.length - 1;
			while (lo < hi) {
				const mid = (lo + hi) >> 1;
				if (at < rawStarts[mid] + tops[mid].raw.length) hi = mid;
				else lo = mid + 1;
			}
			const leaf = leafIn(tops[lo], at - rawStarts[lo], false, mapOf);
			return leaf && { path: [lo, ...leaf.path], offset: leaf.offset };
		},
		byteOf(path, offset) {
			const top = tops[path[0]];
			if (!top) return null;
			const inBlock = byteIn(top, path.slice(1), offset, false, mapOf);
			return inBlock === null ? null : rawStarts[path[0]] + inBlock;
		},
		containerMap: (node) => (isMapped(node) ? mapOf(node) : null)
	};
}

/** A container's lines, offsets into its raw; null for a table row, whose cells share one line. */
export function containerLines(map: ContainerMap): ContainerLine[] | null {
	const { rawLines, paired } = map;
	if (!rawLines || !paired) return null;
	return rawLines.map((line, r) => {
		const pair = paired[r];
		const markerEnd = pair
			? line.start + Math.min(Math.max(pair.at, 0), line.text.length)
			: line.end;
		return { start: line.start, markerEnd, end: line.end, own: !pair };
	});
}

/** Where child `index` of `node` starts its blank lines, in `node`'s raw. */
export function childTriviaStart(map: ContainerMap, node: NodeView, index: number): number {
	return map.toRaw(map.childStarts[index] - node.children![index].leadingTrivia.length);
}

/** Where each child of the container `node` starts in its raw, past the child's blank lines. */
export function childRawStarts(node: NodeView): number[] {
	const map = bodyMap(node);
	return map.childStarts.map((start) => map.toRaw(start));
}

// The two below keep a strip-only refusal (null past a fenced or grid container's opener line)
// until each caller moves onto the byte mapping above.

/** The leaf and offset `rawOffset` addresses inside `node`. Interim: `caret-target.ts` moves at
 *  stage 2, `node-ops.ts` at stage 3, and paste's callers go at stage 4. */
export function leafAtRawOffset(node: NodeView, rawOffset: number): LeafPosition | null {
	return leafIn(node, rawOffset, true, bodyMap);
}

/** The inverse of {@link leafAtRawOffset}. Interim: `leaf-commit.ts` and the conformance kit move
 *  with the plugin-interface migration. */
export function rawOffsetOfLeaf(
	node: NodeView,
	path: readonly number[],
	offset: number
): number | null {
	return byteIn(node, path, offset, true, bodyMap);
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

/** A container the byte map pairs lines for; any other block reads as a leaf. */
function isMapped(node: NodeView): boolean {
	return !!tryGetBlockKindDescriptor(node.kind)?.isContainer && !!node.children?.length;
}

function leafIn(
	node: NodeView,
	rawOffset: number,
	stripOnly: boolean,
	mapOf: (node: NodeView) => ContainerMap
): LeafPosition | null {
	const children = node.children;
	if (!children || !isMapped(node)) {
		return { path: [], offset: Math.min(Math.max(rawOffset, 0), displayLength(node.raw)) };
	}
	if (rowIsOpenerLine(node.kind) && rawOffset <= displayLength(children[0].raw)) {
		return { path: [0], offset: Math.max(rawOffset, 0) };
	}
	if (stripOnly && tryGetBlockKindDescriptor(node.kind)?.containerContract !== 'strip') return null;
	const map = mapOf(node);
	const inner = map.toBody(rawOffset);
	for (let i = 0; i < children.length; i++) {
		const start = map.childStarts[i];
		if (inner <= start + displayLength(children[i].raw) || i === children.length - 1) {
			const leaf = leafIn(children[i], Math.max(inner - start, 0), stripOnly, mapOf);
			return leaf && { path: [i, ...leaf.path], offset: leaf.offset };
		}
	}
	return null;
}

function byteIn(
	node: NodeView,
	path: readonly number[],
	offset: number,
	stripOnly: boolean,
	mapOf: (node: NodeView) => ContainerMap
): number | null {
	if (path.length === 0) return offset;
	if (path.length === 1 && path[0] === 0 && rowIsOpenerLine(node.kind)) return offset;
	const descriptor = tryGetBlockKindDescriptor(node.kind);
	const child = node.children?.[path[0]];
	if (!descriptor?.isContainer || !child) return null;
	if (stripOnly && descriptor.containerContract !== 'strip') return null;
	const inChild = byteIn(child, path.slice(1), offset, stripOnly, mapOf);
	if (inChild === null) return null;
	const map = mapOf(node);
	return map.toRaw(map.childStarts[path[0]] + inChild);
}

// ── Line mapping ─────────────────────────────────────────────────────────────

/** A container's body (its children's bytes as they read on their own) against its raw. */
export interface ContainerMap {
	/** Where each child's own bytes start in the body, past its blank lines. */
	childStarts: number[];
	/** The container's raw lines, and the body line and text column each carries; a table row,
	 *  whose cells share one line, has neither. */
	rawLines?: ParsedLine[];
	paired?: ({ line: number; at: number } | null)[];
	toBody(rawOffset: number): number;
	toRaw(bodyOffset: number): number;
}

function bodyMap(node: NodeView): ContainerMap {
	const children = node.children ?? [];
	const grid = isGridKind(node.kind);
	return grid && children.every((child) => !child.children) ? cellMap(node) : lineMap(node);
}

/** A container whose children sit on its lines behind markers, or verbatim between lines of its
 *  own. A title row goes first in the body, ahead of the inner prefix. */
function lineMap(node: NodeView): ContainerMap {
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
		rawLines: raw,
		paired,
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
			if (r === undefined) {
				// A body line no raw line carries (an empty body under a title) sits at the end of the
				// raw line before the next one carried.
				const below = carrier.slice(b + 1).find((at) => at !== undefined) ?? raw.length;
				const line = raw[Math.max(below - 1, 0)];
				return line ? line.start + line.text.length : 0;
			}
			const column = Math.min(bodyOffset - bodyLines[b].start, bodyLines[b].text.length);
			const at = Math.min(Math.max(paired[r]!.at + column, 0), raw[r].text.length);
			return raw[r].start + at;
		}
	};
}

/** A table row: its cells lie in order inside its one line, the bytes taken as they stand. */
function cellMap(node: NodeView): ContainerMap {
	let cursor = 0;
	const childStarts = (node.children ?? []).map((cell) => {
		const found = cell.raw === '' ? -1 : node.raw.indexOf(cell.raw, cursor);
		// An empty or padded cell sits just past the next pipe, or where the cells before it end.
		const pipe = node.raw.indexOf('|', cursor);
		const start = found >= 0 ? found : pipe >= 0 ? pipe + 1 : cursor;
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
	const { text } = body;
	if (isBlankText(text)) {
		if (!MARKER_ONLY.test(raw.text)) return null;
		// A blank body line's spaces sit at the end of its marker.
		return raw.text.endsWith(text) ? raw.text.length - text.length : raw.text.length;
	}
	const behind = raw.text.length - text.length;
	if (raw.text.endsWith(text) && MARKER_ONLY.test(raw.text.slice(0, behind))) return behind;
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
	let lo = 0;
	let hi = Math.max(lines.length - 1, 0);
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (offset < lines[mid].end) hi = mid;
		else lo = mid + 1;
	}
	return lo;
}
