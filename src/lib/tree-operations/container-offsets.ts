/**
 * Maps between a byte offset in a block's `raw` (or a whole document's bytes) and a caret position
 * in one of its leaves, and finds where a container's marker takes its space. A container's raw
 * re-prefixes its children's lines (`> `, an item's indent) or holds them between lines of its own
 * (a fence, a title tag), so the map pairs the container's lines with its children's: one child's
 * alone where its span says where it sits (a quote, a table), every line where none does.
 */

import type { NodeView } from '../core/node-views';
import {
	displayLength,
	isBlankText,
	isWhitespaceChar,
	splitLines,
	type ParsedLine
} from '../core/lines';
import { blockFacts } from '../schema/block-facts';
import { isGridKind, tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { reservedChromeKindOf, rowIsOpenerLine } from '../schema/reserved-chrome';
import { spanHolding } from '../schema/child-spans';
import { recordLinesPaired } from '../perf/instruments';
import type { Measured } from './top-level-starts';

export interface LeafPosition {
	/** Child indices from the node down to the leaf; empty when the node is the leaf. */
	path: number[];
	/** Offset into the leaf's raw, within its displayed text. */
	offset: number;
}

// ── Public API ───────────────────────────────────────────────────────────────

/** The leaf and offset byte `at` of the document's bytes sits at; a byte of a marker, a container's
 *  own line or a line ending goes to the nearest text on its line. Null for an empty document. */
export function leafAtByte(measured: Measured, at: number): LeafPosition | null {
	return documentByteMap(measured).leafAt(at);
}

/** The byte of the document's bytes that offset `offset` of the leaf at `path` sits at. */
export function byteOfLeaf(
	measured: Measured,
	path: readonly number[],
	offset: number
): number | null {
	return documentByteMap(measured).byteOf(path, offset);
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

export function documentByteMap({ doc, starts }: Measured): DocumentByteMap {
	const maps = new Map<NodeView, ContainerMap>();
	const mapOf = (node: NodeView): ContainerMap => {
		let map = maps.get(node);
		if (!map) maps.set(node, (map = bodyMap(node)));
		return map;
	};
	const tops = doc.children;
	const rawStartOf = (i: number) => starts.start(i) + tops[i].leadingTrivia.length;
	return {
		leafAt(at) {
			if (tops.length === 0) return null;
			const top = starts.holding(at);
			const leaf = leafIn(tops[top], at - rawStartOf(top), false, mapOf);
			return leaf && { path: [top, ...leaf.path], offset: leaf.offset };
		},
		byteOf(path, offset) {
			const top = tops[path[0]];
			if (!top) return null;
			const inBlock = byteIn(top, path.slice(1), offset, false, mapOf);
			return inBlock === null ? null : rawStartOf(path[0]) + inBlock;
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
	return map.rawOf(index, -node.children![index].leadingTrivia.length);
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
	const { index, offset } = mapOf(node).childAt(rawOffset);
	const leaf = leafIn(children[index], offset, stripOnly, mapOf);
	return leaf && { path: [index, ...leaf.path], offset: leaf.offset };
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
	return inChild === null ? null : mapOf(node).rawOf(path[0], inChild);
}

// ── Line mapping ─────────────────────────────────────────────────────────────

/** A container's children against its raw. */
export interface ContainerMap {
	/** The child whose text byte `rawOffset` of the raw goes to, and the offset into its raw. */
	childAt(rawOffset: number): { index: number; offset: number };
	/** Where offset `offset` of child `index`'s raw sits in the container's; a negative offset counts
	 *  back into the child's blank lines. */
	rawOf(index: number, offset: number): number;
	/** The container's raw lines, and the body line and text column each carries; a table row,
	 *  whose cells share one line, has neither. */
	rawLines?: ParsedLine[];
	paired?: ({ line: number; at: number } | null)[];
}

/** Offsets in the body, the children's bytes as they read on their own, joined. */
interface BodyMap {
	/** Where child `index`'s own bytes start in the body, past its blank lines. */
	childStart(index: number): number;
	toBody(rawOffset: number): number;
	toRaw(bodyOffset: number): number;
}

function bodyMap(node: NodeView): ContainerMap {
	const children = node.children ?? [];
	if (isGridKind(node.kind) && children.every((child) => !child.children)) {
		return throughBody(children, cellStarts(node));
	}
	const titled = reservedChromeKindOf(node.kind) !== undefined;
	const verbatim = !titled && verbatimStarts(node);
	if (verbatim) return identityMap(node, verbatim);
	return !titled && spansHold(node) ? spannedMap(node) : lineMap(node, titled);
}

/** The questions a container map answers, asked through its body. */
function throughBody(
	children: readonly NodeView[],
	body: BodyMap
): Pick<ContainerMap, 'childAt' | 'rawOf'> {
	return {
		childAt(rawOffset) {
			const inner = body.toBody(rawOffset);
			// The first child whose text runs to `inner`, or the last.
			let lo = 0;
			let hi = children.length - 1;
			while (lo < hi) {
				const mid = (lo + hi) >> 1;
				if (inner <= body.childStart(mid) + displayLength(children[mid].raw)) hi = mid;
				else lo = mid + 1;
			}
			return { index: lo, offset: Math.max(inner - body.childStart(lo), 0) };
		},
		rawOf: (index, offset) => body.toRaw(body.childStart(index) + offset)
	};
}

/** A container whose children sit on its lines behind markers, or verbatim between lines of its
 *  own, every line paired. A title row goes first in the body, ahead of the inner prefix. */
function lineMap(node: NodeView, titled: boolean): ContainerMap {
	const children = node.children ?? [];
	const childStarts: number[] = [];
	let body = '';
	// Read off each piece as it goes on, since testing the growing body rescans it once per child.
	let endsLine = false;
	const append = (text: string) => {
		if (text === '') return;
		body += text;
		endsLine = text.endsWith('\n') || text.endsWith('\r');
	};
	const add = (i: number) => {
		// A grid's rebuild may put the line break between rows that their own bytes leave out.
		if (body !== '' && !endsLine && !/^[\r\n]/.test(children[i].leadingTrivia)) append('\n');
		append(children[i].leadingTrivia);
		childStarts[i] = body.length;
		append(children[i].raw);
	};
	if (titled) add(0);
	append(node.innerPrefix ?? '');
	for (let i = titled ? 1 : 0; i < children.length; i++) add(i);
	append(node.innerSuffix ?? '');
	const pairing = pairLines(node.raw, body, (index) => childStarts[index]);
	return { ...throughBody(children, pairing), rawLines: pairing.rawLines, paired: pairing.paired };
}

/** Whether a quote's or a table's spans can be asked: one per child. A span that doesn't hold its
 *  child is found out when that child is asked about. */
function spansHold(node: NodeView): boolean {
	const lines = blockFacts(node.kind).lines;
	if (lines !== 'every-line' && lines !== 'rows') return false;
	return node.childSpans?.length === (node.children?.length ?? 0) * 2;
}

/** A quote or a table found through its child spans: a question about one child pairs that child's
 *  lines alone, and every line is paired only for a byte no span holds, or a stale span. */
function spannedMap(node: NodeView): ContainerMap {
	const children = node.children!;
	const spans = node.childSpans!;
	let whole: ContainerMap | undefined;
	const all = () => (whole ??= lineMap(node, false));
	const regions = new Map<number, BodyMap | null>();
	const region = (index: number) => {
		if (!regions.has(index)) regions.set(index, regionMap(node, index));
		return regions.get(index)!;
	};
	const rawOf = (index: number, offset: number): number => {
		const child = children[index];
		const map = region(index);
		const at = child.leadingTrivia.length + offset;
		const length = child.leadingTrivia.length + child.raw.length;
		// The end of a child whose bytes end a line is where the next child's lines start.
		const ends = at === length && (child.raw || child.leadingTrivia).endsWith('\n');
		if (!map || at < 0 || at > length || (ends && index === children.length - 1)) {
			return all().rawOf(index, offset);
		}
		if (ends) return rawOf(index + 1, -children[index + 1].leadingTrivia.length);
		return spans[index * 2] + map.toRaw(at);
	};
	return {
		childAt(rawOffset) {
			const index = spanHolding(spans, rawOffset);
			const map = index < 0 ? null : region(index);
			if (!map) return all().childAt(rawOffset);
			const inner = map.toBody(rawOffset - spans[index * 2]);
			return { index, offset: Math.max(inner - map.childStart(0), 0) };
		},
		rawOf,
		get rawLines() {
			return all().rawLines;
		},
		get paired() {
			return all().paired;
		}
	};
}

/** Child `index`'s lines paired against the region its span gives it; null where they don't pair
 *  one for one, a span that doesn't say where the child sits. */
function regionMap(node: NodeView, index: number): BodyMap | null {
	const child = node.children![index];
	const spans = node.childSpans!;
	const region = node.raw.slice(spans[index * 2], spans[index * 2 + 1]);
	const trivia = child.leadingTrivia.length;
	const pairing = pairLines(region, child.leadingTrivia + child.raw, () => trivia);
	return pairing.oneForOne ? pairing : null;
}

/** `rawText`'s lines paired in order with `body`'s: each raw line with the body line it carries and
 *  the column that line's text starts at, or with none. */
function pairLines(
	rawText: string,
	body: string,
	childStart: (index: number) => number
): BodyMap & {
	rawLines: ParsedLine[];
	paired: ({ line: number; at: number } | null)[];
	/** Every raw line carries the body line of its own index, and every body line is carried. */
	oneForOne: boolean;
} {
	const raw = splitLines(rawText);
	const bodyLines = splitLines(body);
	const paired: ({ line: number; at: number } | null)[] = [];
	const carrier: number[] = [];
	let next = 0;
	for (let r = 0; r < raw.length; r++) {
		const at = next < bodyLines.length ? textColumn(raw[r], bodyLines[next]) : null;
		paired.push(at === null ? null : { line: next, at });
		if (at !== null) carrier[next++] = r;
	}
	recordLinesPaired(raw.length);
	return {
		childStart,
		rawLines: raw,
		paired,
		oneForOne: next === raw.length && next === bodyLines.length,
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

/** Where each child starts in a list's raw, its items' bytes and nothing else; null for any other
 *  container. The list's child spans answer for an item they hold, reading no item before it. */
function verbatimStarts(node: NodeView): ((index: number) => number) | null {
	if (blockFacts(node.kind).lines !== 'items' || node.innerPrefix || node.innerSuffix) return null;
	const children = node.children ?? [];
	const { raw, childSpans: spans } = node;
	let summed: number[] | null | undefined;
	const sum = () => (summed ??= summedStarts(children, raw));
	if (spans?.length !== children.length * 2 || spans[spans.length - 1] !== raw.length) {
		const starts = sum();
		return starts && ((index) => starts[index]);
	}
	return (index) => {
		const child = children[index];
		const start = spans[index * 2 + 1] - child.raw.length;
		return raw.startsWith(child.raw, start) ? start : (sum()?.[index] ?? start);
	};
}

/** Each child's start, summed over every child before it; null when they don't add up to `raw`. */
function summedStarts(children: readonly NodeView[], raw: string): number[] | null {
	const starts: number[] = [];
	let at = 0;
	// Indexed: the items may be a `$state` proxy, where an iterator pays a trap per step.
	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		at += child.leadingTrivia.length;
		starts.push(at);
		at += child.raw.length;
	}
	return at === raw.length ? starts : null;
}

const same = (offset: number) => offset;

/** A container that adds no bytes to its children's (a list): every offset is the same in both,
 *  and its lines are split only when a caller asks for them. */
function identityMap(node: NodeView, childStart: (index: number) => number): ContainerMap {
	let lines: ParsedLine[] | undefined;
	const rawLines = () => (lines ??= splitLines(node.raw));
	return {
		...throughBody(node.children ?? [], { childStart, toBody: same, toRaw: same }),
		get rawLines() {
			return rawLines();
		},
		get paired() {
			return rawLines().map((_, line) => ({ line, at: 0 }));
		}
	};
}

/** A table row: its cells lie in order inside its one line, the bytes taken as they stand. */
function cellStarts(node: NodeView): BodyMap {
	let cursor = 0;
	const childStarts = (node.children ?? []).map((cell) => {
		const found = cell.raw === '' ? -1 : node.raw.indexOf(cell.raw, cursor);
		// An empty or padded cell sits just past the next pipe, or where the cells before it end.
		const pipe = node.raw.indexOf('|', cursor);
		const start = found >= 0 ? found : pipe >= 0 ? pipe + 1 : cursor;
		cursor = start + cell.raw.length;
		return start;
	});
	return { childStart: (index) => childStarts[index], toBody: same, toRaw: same };
}

/** A marker run alone on a line: quote markers, a list marker and its task box, a footnote label. */
const MARKER_ONLY =
	/^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])(?:[ \t]+\[[ xX]\])?[ \t]*|\[\^[^\]\s]+\]:[ \t]*)?$/;

/** Where `body`'s text starts in raw line `raw`, or null when the line carries none of it: its
 *  tail behind a marker, its text behind a marker a tab was cut in, or a title inside tags. */
function textColumn(raw: ParsedLine, body: ParsedLine): number | null {
	const { text } = body;
	if (isBlankText(text)) {
		// A blank body line's spaces sit at the end of its marker; a title with no text, in its tags.
		if (!MARKER_ONLY.test(raw.text)) return inTags(raw.text, text);
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
	return inTags(raw.text, text);
}

function inTags(line: string, text: string): number | null {
	const at = line.indexOf('>' + text + '<');
	return at < 0 ? null : at + 1;
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
