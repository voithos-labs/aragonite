/**
 * The two shared container rebuilds, a joined body (list, table) and a line-prefixed one (quote,
 * list item), and each child's byte span in its container's `raw`, so a keystroke rewrites one
 * region instead of every child. A span left stale fails the region check and falls back to the
 * full rebuild; a `Uint32Array` because Svelte proxies plain arrays.
 */

import { isDevChecks } from '../env';
import { makeBlockNode, type CstNode } from '../core/nodes';
import { assertInvariant } from '../assert';
import { perfEnabled, recordStripLinesRead } from '../perf/instruments';
import { concatChildren } from '../core/serializer';
import { endsInBlankLine, isBlankLine, isBlankText, splitLines } from '../core/lines';
import {
	FIRST_LINE,
	INNER_LINE,
	type BodyLine,
	type LineCodec,
	type LinePlace
} from '../core/strip-lines';

/** The child a rebuild is re-rendering, and the bytes its region currently holds. */
export interface ChildRawChange {
	index: number;
	previousRaw: string;
}

/** The space a container's marker lacks, written into its own bytes at `at`, the start of the
 *  child behind the marker; the next rebuild keeps the line as written. */
export function writeMarkerSpace(container: CstNode, at: number): void {
	container.raw = container.raw.slice(0, at) + ' ' + container.raw.slice(at);
	dropChildSpans(container);
}

/** Drop the spans a change to the children invalidated; the next full rebuild recomputes them. */
export function dropChildSpans(node: CstNode): void {
	// Checked before writing: an unconditional write would add the field to every node passed in.
	if (node.childSpans) node.childSpans = undefined;
}

// ── Rebuilds ─────────────────────────────────────────────────────────────────

/** A container whose raw is its children's bytes joined (list). */
export function rebuildConcatRaw(node: CstNode, changed?: ChildRawChange): void {
	const children = node.children!;
	if (changed && spliceVerbatimChild(node, changed, rebuildConcatRaw)) return;

	const spans = new Uint32Array(children.length * 2);
	let out = '';
	for (let i = 0; i < children.length; i++) {
		// One indexed read per child: the array is a `$state` proxy, so every read is a proxy trap.
		const child = children[i];
		spans[i * 2] = out.length;
		out += child.leadingTrivia + child.raw;
		spans[i * 2 + 1] = out.length;
	}
	node.raw = out;
	node.childSpans = spans;
}

/**
 * For a container whose raw holds each child's bytes as they are (a list's items, a table's rows):
 * rewrites the changed child's region in place, or returns false for the caller's full rebuild.
 */
export function spliceVerbatimChild(
	node: CstNode,
	changed: ChildRawChange,
	rebuildFull: (scratch: CstNode) => void
): boolean {
	const rewrite: RegionRewrite = (region, { trivia, child }) =>
		region === trivia + changed.previousRaw ? trivia + child.raw : null;
	return spliceChildRegion(node, changed, rewrite) && spliceIsFaithful(node, rebuildFull);
}

/** What a strip rebuild tells the chain above it. */
export interface StripRebuild {
	/** A kept lazy line stopped continuing a paragraph, so the node's bytes must be read whole. */
	rereads: boolean;
}

/** A quote or list item, each line written from its pair in the previous bytes while that still
 *  reads the same text; `previous` reads those bytes when their metadata has since changed. */
export function rebuildStripRaw(
	node: CstNode,
	lines: LineCodec,
	changed?: ChildRawChange,
	previous: LineCodec = lines
): StripRebuild {
	if (changed && previous === lines) {
		const outcome = { rereads: false };
		const rewrite: RegionRewrite = (region, at) => {
			const written = rewriteStripRegion(region, at, changed, lines);
			outcome.rereads = written?.rereads ?? false;
			return written?.out ?? null;
		};
		const full = (scratch: CstNode) => rebuildStripRaw(scratch, lines);
		if (spliceChildRegion(node, changed, rewrite) && spliceIsFaithful(node, full)) return outcome;
	}

	// One indexed read per child: the array is a `$state` proxy, so every read is a proxy trap.
	const children = node.children!.map((child) => child);
	const suffix = node.innerSuffix ?? '';
	// Every child from `blankTail` on, and the suffix, holds whitespace only.
	let blankTail = children.length;
	if (isBlankText(suffix)) {
		while (blankTail > 0 && isBlankText(children[blankTail - 1].raw)) blankTail--;
	} else {
		blankTail = children.length + 1;
	}

	// A child ending mid-line shares that line with whatever follows, so its lines can't be told
	// apart from the next child's: the whole body is written as one text.
	if (opensMidLine(children, suffix)) return rebuildWholeStrip(node, lines, previous);

	const raw = node.raw;
	const spans = new Uint32Array(children.length * 2);
	const tailIsBlank = (i: number) => () => blankTail <= i + 1;
	const keeps = previous === lines;
	const head = keeps ? keptHead(raw, children, lines, spans) : NO_HEAD;
	let tail = keeps && suffix === '' ? keptTail(raw, children, lines, head) : noTail(raw, children);
	let rest = writeBetween(raw, children, suffix, lines, previous, head, tail, tailIsBlank);
	if (rest === null) {
		tail = noTail(raw, children);
		rest = writeBetween(raw, children, suffix, lines, previous, head, tail, tailIsBlank)!;
	}
	// The kept tail's bytes move by however much the lines above it grew or shrank.
	const shift = head.rawEnd + rest.out.length - tail.rawStart;
	for (let k = 0; k < tail.spans.length; k += 2) spans[tail.spans[k]] = tail.spans[k + 1] + shift;
	for (let k = 0; k < rest.bounds.length; k += 2) {
		spans[rest.bounds[k]] = head.rawEnd + rest.offsets[rest.bounds[k + 1]];
	}
	node.raw = raw.slice(0, head.rawEnd) + rest.out + raw.slice(tail.rawStart);
	node.childSpans = spans;
	return { rereads: rest.rereads };
}

/** The body lines between the kept head and tail written over the previous lines between them,
 *  or null when the line-by-line pairing would have run past them into the kept tail. */
function writeBetween(
	raw: string,
	children: CstNode[],
	suffix: string,
	lines: LineCodec,
	previous: LineCodec,
	head: KeptHead,
	tail: KeptTail,
	tailIsBlank: (i: number) => () => boolean
): { out: string; offsets: number[]; bounds: number[]; rereads: boolean } | null {
	const fresh: BodyLineOut[] = [];
	// Pairs of a span slot and the line index it starts or ends at.
	const bounds: number[] = [];
	const last = tail.at === 0 ? tail.child - 1 : tail.child;
	for (let i = head.child; i <= last && i < children.length; i++) {
		const child = children[i];
		const from = i === head.child ? head.at : 0;
		const whole = i < tail.child || (i === tail.child && tail.at === 0);
		const to = whole ? child.leadingTrivia.length + child.raw.length : tail.at;
		if (from === 0) bounds.push(i * 2, fresh.length);
		const first = fresh.length === 0 && head.lines === 0;
		const leaf = child.children === undefined;
		const inBlankTail = whole && leaf ? tailIsBlank(i) : () => false;
		pushChildPart(fresh, child.leadingTrivia, child.raw, from, to, first, inBlankTail);
		if (whole) bounds.push(i * 2 + 1, fresh.length);
	}
	if (suffix !== '') pushLines(fresh, suffix, fresh.length === 0 && head.lines === 0, () => true);

	const old = readOldLines(raw.slice(head.rawEnd, tail.rawStart), previous, head.rawEnd === 0);
	if (tail.first && runsIntoTail(old, fresh, tail.first)) return null;
	const written = writeLines(old, fresh, lines, head.above);
	return { ...written, bounds };
}

/** Whether pairing from the top, having matched every line on the shorter side, would match the
 *  first line of the kept tail too, which the walk from the bottom kept at another pairing. */
function runsIntoTail(old: OldLine[], fresh: BodyLineOut[], first: KeptLine): boolean {
	if (old.length === fresh.length) return false;
	const shorter = Math.min(old.length, fresh.length);
	for (let j = 0; j < shorter; j++) if (!holds(old[j], fresh[j])) return false;
	return old.length < fresh.length
		? holds(first.old, fresh[shorter])
		: holds(old[shorter], first.fresh);
}

function opensMidLine(children: CstNode[], suffix: string): boolean {
	let openLine = false;
	for (const child of children) {
		// The child's last byte, read without joining its trivia and raw.
		const last = child.raw !== '' ? child.raw : child.leadingTrivia;
		if (last === '') continue;
		if (openLine) return true;
		openLine = last[last.length - 1] !== '\n';
	}
	return openLine && suffix !== '';
}

// ── The kept head ────────────────────────────────────────────────────────────

/** The run of body lines from the top whose previous bytes are the container's own spelling of
 *  them, kept as one slice of those bytes; the rest of the body is written line by line after. */
interface KeptHead {
	/** Lines kept. */
	lines: number;
	/** The end of the kept bytes in the previous raw. */
	rawEnd: number;
	/** The child the rest starts in, and where in its leading trivia and raw. */
	child: number;
	at: number;
	/** The last kept line, which a lazy line just below it is read against. */
	above?: KeptLine;
}

const NO_HEAD: KeptHead = { lines: 0, rawEnd: 0, child: 0, at: 0 };

/** The lines the line-by-line rebuild would pair from the top and keep whole, found a line at a
 *  time; a line that may fall in the body's closing blank run stops it, its place being unknown. */
function keptHead(
	raw: string,
	children: CstNode[],
	lines: LineCodec,
	spans: Uint32Array
): KeptHead {
	let count = 0;
	let rawAt = 0;
	// Where the last kept line starts, in its child's text and in the previous bytes.
	let lastPart = '';
	let lastPos = 0;
	let lastRawAt = 0;
	const stop = (child: number, at: number): KeptHead => ({
		lines: count,
		rawEnd: rawAt,
		child,
		at,
		above: count > 0 ? lineAbove(lastPart, lastPos, raw, lastRawAt, lines) : undefined
	});
	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		spans[i * 2] = rawAt;
		// A leaf's blank lines at its end can take the body's blank-run place.
		const walkRaw = child.children !== undefined || !endsInBlankLine(child.raw);
		for (let p = 0; p < 2; p++) {
			const part = p === 0 ? child.leadingTrivia : child.raw;
			const partStart = p === 0 ? 0 : child.leadingTrivia.length;
			let pos = 0;
			while (pos < part.length) {
				if ((p === 1 && !walkRaw) || rawAt === raw.length) return stop(i, partStart + pos);
				const fresh = lineAt(part, pos);
				const old = lineAt(raw, rawAt);
				const place = rawAt === 0 ? FIRST_LINE : INNER_LINE;
				if (old.ending !== fresh.ending || !keepsWhole(old.text, fresh.text, place, lines)) {
					return stop(i, partStart + pos);
				}
				lastPart = part;
				lastPos = pos;
				lastRawAt = rawAt;
				count++;
				rawAt += old.text.length + old.ending.length;
				pos += fresh.text.length + fresh.ending.length;
			}
		}
		spans[i * 2 + 1] = rawAt;
	}
	return stop(children.length, 0);
}

/** Whether a previous line holds `text` at `place` and is no lazy line, so the line-by-line
 *  rebuild keeps it whole; its spelling answers without a reading. */
function keepsWhole(line: string, text: string, place: LinePlace, lines: LineCodec): boolean {
	if (lines.spells(line, text, place)) return true;
	const body = readLine(lines, line, place);
	return body !== null && body.text === text && !body.lazy;
}

// ── The kept tail ────────────────────────────────────────────────────────────

/** {@link KeptHead} from the bottom: the run of lines below the head whose previous bytes are
 *  kept as one slice, then moved by however much the lines above them changed length. */
interface KeptTail {
	/** The start of the kept bytes in the previous raw. */
	rawStart: number;
	/** The child the kept lines start in, and where in its leading trivia and raw. */
	child: number;
	at: number;
	/** Pairs of a span slot and its offset in the previous raw. */
	spans: number[];
	/** The first kept line, which pairing from the top must not reach. */
	first?: KeptLine;
}

const noTail = (raw: string, children: CstNode[]): KeptTail => ({
	rawStart: raw.length,
	child: children.length,
	at: 0,
	spans: []
});

/** Walks up from the last line, as {@link keptHead} walks down, stopping at the head's lines and
 *  short of the body's first line, whose place is read apart from the rest. */
function keptTail(raw: string, children: CstNode[], lines: LineCodec, head: KeptHead): KeptTail {
	const spans: number[] = [];
	let rawAt = raw.length;
	// Where the first kept line starts, in its child's text and in the previous bytes.
	let firstPart = '';
	let firstPos = 0;
	let firstRawAt = -1;
	let bodyStart = 0;
	while (bodyStart < children.length && textLength(children[bodyStart]) === 0) bodyStart++;
	const stop = (child: number, at: number): KeptTail => {
		const ended = child < children.length && at === textLength(children[child]);
		return {
			rawStart: rawAt,
			child: ended ? child + 1 : child,
			at: ended ? 0 : at,
			spans,
			first: firstRawAt < 0 ? undefined : lineAbove(firstPart, firstPos, raw, firstRawAt, lines)
		};
	};
	for (let i = children.length - 1; i >= head.child; i--) {
		const child = children[i];
		spans.push(i * 2 + 1, rawAt);
		const trivia = child.leadingTrivia.length;
		// A leaf's blank lines at its end can take the body's blank-run place.
		if (child.children === undefined && endsInBlankLine(child.raw)) {
			return stop(i, textLength(child));
		}
		for (let p = 1; p >= 0; p--) {
			const part = p === 0 ? child.leadingTrivia : child.raw;
			const partStart = p === 0 ? 0 : trivia;
			let pos = part.length;
			while (pos > 0) {
				const fresh = lineBefore(part, pos);
				const old = rawAt > 0 ? lineBefore(raw, rawAt) : null;
				const opensBody = head.lines === 0 && i === bodyStart && partStart + fresh.start === 0;
				if (
					!old ||
					old.start === 0 ||
					old.start < head.rawEnd ||
					opensBody ||
					(i === head.child && partStart + fresh.start < head.at) ||
					old.ending !== fresh.ending ||
					!keepsWhole(old.text, fresh.text, INNER_LINE, lines)
				) {
					return stop(i, partStart + pos);
				}
				firstPart = part;
				firstPos = fresh.start;
				firstRawAt = old.start;
				rawAt = old.start;
				pos = fresh.start;
			}
		}
		spans.push(i * 2, rawAt);
	}
	return stop(head.child, head.at);
}

const textLength = (child: CstNode): number => child.leadingTrivia.length + child.raw.length;

/** The line of `text` ending at `end`, as `splitLines` reads it. */
function lineBefore(text: string, end: number): { start: number; text: string; ending: string } {
	const breakAt = text[end - 1] === '\n' ? end - 1 : -1;
	const searchFrom = (breakAt >= 0 ? breakAt : end) - 1;
	const start = searchFrom >= 0 ? text.lastIndexOf('\n', searchFrom) + 1 : 0;
	if (breakAt < 0) return { start, text: text.slice(start, end), ending: '' };
	const crlf = breakAt - 1 >= start && text[breakAt - 1] === '\r';
	return {
		start,
		text: text.slice(start, crlf ? breakAt - 1 : breakAt),
		ending: crlf ? '\r\n' : '\n'
	};
}

function lineAbove(
	part: string,
	pos: number,
	raw: string,
	rawAt: number,
	lines: LineCodec
): KeptLine {
	const place = rawAt === 0 ? FIRST_LINE : INNER_LINE;
	const fresh = lineAt(part, pos);
	const old = lineAt(raw, rawAt);
	const oldRaw = raw.slice(rawAt, rawAt + old.text.length + old.ending.length);
	return {
		fresh: { text: fresh.text, ending: fresh.ending, place },
		old: { text: old.text, ending: old.ending, raw: oldRaw, codec: lines, place }
	};
}

/** The line of `text` starting at `start`, as `splitLines` reads it. */
function lineAt(text: string, start: number): { text: string; ending: string } {
	const breakAt = text.indexOf('\n', start);
	if (breakAt < 0) return { text: text.slice(start), ending: '' };
	const crlf = breakAt > start && text[breakAt - 1] === '\r';
	return { text: text.slice(start, crlf ? breakAt - 1 : breakAt), ending: crlf ? '\r\n' : '\n' };
}

function rebuildWholeStrip(node: CstNode, lines: LineCodec, previous: LineCodec): StripRebuild {
	const fresh: BodyLineOut[] = [];
	pushLines(fresh, concatChildren(node.children!) + (node.innerSuffix ?? ''), true, () => true);
	const written = writeLines(readOldLines(node.raw, previous, true), fresh, lines);
	node.childSpans = undefined;
	node.raw = written.out;
	return { rereads: written.rereads };
}

// ── Lines ────────────────────────────────────────────────────────────────────

/** A body line the rebuild writes. */
interface BodyLineOut {
	text: string;
	ending: string;
	place: LinePlace;
}

/** A line of the container's previous bytes, and the body line it held where it was read. */
interface OldLine {
	text: string;
	ending: string;
	/** `text` and `ending` together. */
	raw: string;
	/** The syntax and place the line is read under. */
	codec: LineCodec;
	place: LinePlace;
	/** Read on first use, through {@link bodyOf}. */
	body?: BodyLine | null;
}

/** A kept line beside the lines a rebuild writes: the line above them, or the one below. */
interface KeptLine {
	fresh: BodyLineOut;
	old: OldLine;
}

interface ChildAt {
	child: CstNode;
	/** Whether only blank lines follow the child in the body; asked only when it ends blank. */
	tailIsBlank: () => boolean;
}

/** A child's separator lines, which stay bare, then its own; a leaf's blank lines that end the
 *  body keep the body's indent, or a reload would read them outside the container. */
function pushChildLines(
	out: BodyLineOut[],
	trivia: string,
	raw: string,
	first: boolean,
	at: ChildAt
): void {
	const leaf = at.child.children === undefined;
	pushChildPart(
		out,
		trivia,
		raw,
		0,
		trivia.length + raw.length,
		first,
		() => leaf && at.tailIsBlank()
	);
}

/** {@link pushChildLines} for the lines from `from` to `to` of the child's trivia and raw
 *  together; `inBlankTail` is asked only of a part that reaches the child's end. */
function pushChildPart(
	out: BodyLineOut[],
	trivia: string,
	raw: string,
	from: number,
	to: number,
	first: boolean,
	inBlankTail: () => boolean
): void {
	const before = out.length;
	const cut = trivia.length;
	pushLines(out, trivia.slice(Math.min(from, cut), Math.min(to, cut)), first, () => false);
	const ownLines = raw.slice(Math.max(from, cut) - cut, Math.max(to, cut) - cut);
	pushLines(out, ownLines, first && out.length === before, inBlankTail);
}

function pushLines(
	out: BodyLineOut[],
	text: string,
	first: boolean,
	inBlankTail: () => boolean
): void {
	if (text === '') return;
	const lines = splitLines(text);
	let lastContent = lines.length - 1;
	while (lastContent >= 0 && isBlankLine(lines[lastContent].text)) lastContent--;
	const endsBlank = lastContent < lines.length - 1 && inBlankTail();
	lines.forEach((line, i) =>
		out.push({
			text: line.text,
			ending: line.lineEnding,
			place: { first: first && i === 0, trailingBlank: endsBlank && i > lastContent }
		})
	);
}

function readOldLines(raw: string, codec: LineCodec, opensContainer: boolean): OldLine[] {
	return splitLines(raw).map((line, i) => {
		const place = opensContainer && i === 0 ? FIRST_LINE : INNER_LINE;
		return { text: line.text, ending: line.lineEnding, raw: line.raw, codec, place };
	});
}

function bodyOf(old: OldLine): BodyLine | null {
	if (old.body === undefined) old.body = readLine(old.codec, old.text, old.place);
	return old.body;
}

/** Whether the old line holds `line`; a line in the container's own spelling of the text needs
 *  no reading. */
function holds(old: OldLine, line: BodyLineOut): boolean {
	if (old.ending !== line.ending) return false;
	return old.codec.spells(old.text, line.text, old.place) || bodyOf(old)?.text === line.text;
}

/** One container line read through its syntax, counted under the perf instruments. */
function readLine(codec: LineCodec, line: string, place: LinePlace): BodyLine | null {
	if (perfEnabled()) recordStripLinesRead(1);
	return codec.read(line, place);
}

/** `fresh` written over `old`, lines with equal text paired from the top, then the bottom, the
 *  rest in order (`docs/design/editor.md` § The container `raw` contract). */
function writeLines(
	old: OldLine[],
	fresh: BodyLineOut[],
	lines: LineCodec,
	above?: KeptLine
): { out: string; offsets: number[]; rereads: boolean } {
	let head = 0;
	while (head < old.length && head < fresh.length && holds(old[head], fresh[head])) head++;
	let tail = 0;
	while (
		tail < old.length - head &&
		tail < fresh.length - head &&
		holds(old[old.length - 1 - tail], fresh[fresh.length - 1 - tail])
	) {
		tail++;
	}
	const pairOf = (j: number): number => {
		if (j < head) return j;
		if (j >= fresh.length - tail) return old.length - (fresh.length - j);
		return j - head < old.length - head - tail ? j : -1;
	};
	// Last line first: a blank line in the run that ends the body may stay bare only while a line
	// below it holds the run in the body.
	const written: string[] = [];
	let heldBelow = false;
	let rereads = false;
	const reread = () => (rereads = true);
	for (let j = fresh.length - 1; j >= 0; j--) {
		const line = fresh[j];
		const { trailingBlank } = line.place;
		const place: LinePlace =
			trailingBlank && heldBelow ? { ...line.place, trailingBlank: false } : line.place;
		const i = pairOf(j);
		const paired = i >= 0 ? old[i] : null;
		// A head or tail pair already holds this line where it is read, so unless lazy it keeps its
		// bytes without a second reading; a pair matched by its spelling was never read, and isn't.
		if (
			paired !== null &&
			(j < head || j >= fresh.length - tail) &&
			!paired.body?.lazy &&
			readsAsBefore(paired, lines, place)
		) {
			written[j] = paired.raw;
			if (trailingBlank && !heldBelow)
				heldBelow = readLine(lines, paired.text, line.place) !== null;
			continue;
		}
		// A lazy line continues whatever paragraph the line above leaves open, so it is asked again
		// only when that line changed.
		const freshAbove = j > 0 ? fresh[j - 1] : above?.fresh;
		const oldAbove = i > 0 ? old[i - 1] : i === 0 ? above?.old : undefined;
		const continues = (lazyLine: string) =>
			freshAbove !== undefined &&
			((oldAbove !== undefined &&
				bodyOf(oldAbove)?.text === freshAbove.text &&
				old[i].text === lazyLine) ||
				lines.continuesLazily(freshAbove.text, lazyLine, freshAbove.place.first));
		const bytes: string =
			(paired !== null ? kept(paired, line, place, lines, continues, reread) : null) ??
			lines.write(line.text, line.place) + line.ending;
		written[j] = bytes;
		const text: string = bytes.slice(0, bytes.length - line.ending.length);
		if (trailingBlank && !heldBelow) heldBelow = readLine(lines, text, line.place) !== null;
	}
	const offsets: number[] = [];
	let out = '';
	for (const bytes of written) {
		offsets.push(out.length);
		out += bytes;
	}
	offsets.push(out.length);
	return { out, offsets, rereads };
}

/** The paired line's bytes, or its prefix before the new text, where they read that text at
 *  `place`; null when the line takes the container's own spelling. */
function kept(
	old: OldLine,
	line: BodyLineOut,
	place: LinePlace,
	lines: LineCodec,
	continues: (lazyLine: string) => boolean,
	reread: () => void
): string | null {
	const body = bodyOf(old);
	if (body === null) return null;
	if (
		body.text === line.text &&
		old.ending === line.ending &&
		(readsAsBefore(old, lines, place) || readsAs(old.text, body.lazy))
	) {
		// A lazy line the edit didn't touch keeps its bytes even once it stops continuing, and the
		// tree then takes the reading a reload gives them.
		if (body.lazy && !continues(old.text)) reread();
		return old.raw;
	}
	// A blank line is spelled the container's way, so a prefix passes only between text lines.
	if (body.prefix === null || isBlankLine(body.text) || isBlankLine(line.text)) return null;
	const candidate = body.prefix + line.text;
	return readsAs(candidate, body.lazy) && (!body.lazy || continues(candidate))
		? candidate + line.ending
		: null;

	function readsAs(bytes: string, lazy: boolean): boolean {
		const read = readLine(lines, bytes, place);
		return read !== null && read.text === line.text && read.lazy === lazy;
	}
}

/** Whether reading `old` under `codec` at `place` repeats the reading it was taken with. */
function readsAsBefore(old: OldLine, codec: LineCodec, place: LinePlace): boolean {
	return (
		old.codec === codec &&
		old.place.first === place.first &&
		old.place.trailingBlank === place.trailingBlank
	);
}

// ── The splice ───────────────────────────────────────────────────────────────

interface RegionAt {
	trivia: string;
	child: CstNode;
	first: boolean;
	tailIsBlank: () => boolean;
}

/** The child's new region written over its current one, or null when the region doesn't hold
 *  the child's previous bytes. */
type RegionRewrite = (region: string, at: RegionAt) => string | null;

/** The region read back as the child's previous bytes, then written over with its new ones. */
function rewriteStripRegion(
	region: string,
	at: RegionAt,
	changed: ChildRawChange,
	lines: LineCodec
): { out: string; rereads: boolean } | null {
	const before: BodyLineOut[] = [];
	pushChildLines(before, at.trivia, changed.previousRaw, at.first, at);
	const old = readOldLines(region, lines, at.first);
	if (old.length !== before.length) return null;
	for (let i = 0; i < old.length; i++) {
		const read = bodyOf(old[i]);
		if (read === null || read.text !== before[i].text || old[i].ending !== before[i].ending) {
			return null;
		}
	}
	const fresh: BodyLineOut[] = [];
	pushChildLines(fresh, at.trivia, at.child.raw, at.first, at);
	return writeLines(old, fresh, lines);
}

/**
 * A dev-only comparison with a full rebuild on a scratch node, so a sibling's bytes moving under the
 * spans cannot reach the document (G1.38). Skipped under the perf instruments, which would time it.
 */
function spliceIsFaithful(node: CstNode, rebuildFull: (scratch: CstNode) => void): boolean {
	if (!isDevChecks() || perfEnabled()) return true;
	const scratch = makeBlockNode({
		kind: node.kind,
		leadingTrivia: node.leadingTrivia,
		raw: node.raw,
		metadata: node.metadata,
		children: node.children,
		innerPrefix: node.innerPrefix,
		innerSuffix: node.innerSuffix
	});
	rebuildFull(scratch);
	if (scratch.raw === node.raw) return true;
	assertInvariant('child-spans-faithful', () => ({
		code: 'child-spans-faithful',
		message: `${node.kind}: the spliced raw differs from a full rebuild of the same children`,
		detail: { kind: node.kind }
	}));
	return false;
}

/**
 * Rewrite one child's region in place, or decline so the caller rebuilds from scratch: a span that
 * stopped describing `raw` costs a slower rebuild, never corrupted bytes.
 */
function spliceChildRegion(
	node: CstNode,
	changed: ChildRawChange,
	rewrite: RegionRewrite
): boolean {
	const children = node.children!;
	const spans = node.childSpans;
	if (!spans || spans.length !== children.length * 2) return false;

	const child = children[changed.index];
	if (!child) return false;
	const start = spans[changed.index * 2];
	const end = spans[changed.index * 2 + 1];
	const raw = node.raw;
	if (start > end || end > raw.length) return false;

	// A child turning blank, or back, decides whether the empty blocks before it end the body.
	if (isBlankText(changed.previousRaw) !== isBlankText(child.raw)) return false;
	const tailIsBlank = () =>
		isBlankText(node.innerSuffix ?? '') &&
		children
			.slice(changed.index + 1)
			.every((later) => isBlankText(later.leadingTrivia + later.raw));
	const first = start === 0;
	const rendered = rewrite(raw.slice(start, end), {
		trivia: child.leadingTrivia,
		child,
		first,
		tailIsBlank
	});
	if (rendered === null) return false;
	if (end < raw.length) {
		// Nothing may run into the regions that follow: a child not ending in a line ending would
		// share its last line, and an emptied first region hands line 0 to the next child.
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
