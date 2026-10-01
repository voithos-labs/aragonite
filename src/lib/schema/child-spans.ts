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
import { isBlankLine, isBlankText, splitLines } from '../core/lines';
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

	const fresh: BodyLineOut[] = [];
	const bounds: number[] = [];
	// A child ending mid-line shares that line with whatever follows, so its lines can't be told
	// apart from the next child's: the whole body is written as one text.
	let openLine = false;
	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		const text = child.leadingTrivia + child.raw;
		if (openLine && text !== '') return rebuildWholeStrip(node, lines, previous);
		bounds.push(fresh.length);
		pushChildLines(fresh, child.leadingTrivia, child.raw, fresh.length === 0, {
			child,
			tailIsBlank: () => blankTail <= i + 1
		});
		bounds.push(fresh.length);
		if (text !== '') openLine = !text.endsWith('\n');
	}
	if (suffix !== '') {
		if (openLine) return rebuildWholeStrip(node, lines, previous);
		pushLines(fresh, suffix, fresh.length === 0, () => true);
	}

	const written = writeLines(readOldLines(node.raw, previous, true), fresh, lines);
	const spans = new Uint32Array(children.length * 2);
	bounds.forEach((line, i) => (spans[i] = written.offsets[line]));
	node.raw = written.out;
	node.childSpans = spans;
	return { rereads: written.rereads };
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
	/** The syntax and place the line was read under. */
	codec: LineCodec;
	place: LinePlace;
	body: BodyLine | null;
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
	const before = out.length;
	pushLines(out, trivia, first, () => false);
	const leaf = at.child.children === undefined;
	pushLines(out, raw, first && out.length === before, () => leaf && at.tailIsBlank());
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
		const body = readLine(codec, line.text, place);
		return { text: line.text, ending: line.lineEnding, raw: line.raw, codec, place, body };
	});
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
	lines: LineCodec
): { out: string; offsets: number[]; rereads: boolean } {
	const same = (o: OldLine, n: BodyLineOut) =>
		o.body !== null && o.body.text === n.text && o.ending === n.ending;
	let head = 0;
	while (head < old.length && head < fresh.length && same(old[head], fresh[head])) head++;
	let tail = 0;
	while (
		tail < old.length - head &&
		tail < fresh.length - head &&
		same(old[old.length - 1 - tail], fresh[fresh.length - 1 - tail])
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
		// A head or tail pair already reads as this line where it was read, so unless lazy it
		// keeps its bytes without a second reading.
		if (
			paired !== null &&
			(j < head || j >= fresh.length - tail) &&
			!paired.body!.lazy &&
			readsAsBefore(paired, lines, place)
		) {
			written[j] = paired.raw;
			if (trailingBlank && !heldBelow)
				heldBelow = readLine(lines, paired.text, line.place) !== null;
			continue;
		}
		// A lazy line continues whatever paragraph the line above leaves open, so it is asked again
		// only when that line changed.
		const above = j > 0 ? fresh[j - 1].text : null;
		const continues = (lazyLine: string) =>
			above !== null &&
			((i > 0 && old[i - 1].body?.text === above && old[i].text === lazyLine) ||
				lines.continuesLazily(above, lazyLine, fresh[j - 1].place.first));
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
	const body = old.body;
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
		const read = old[i].body;
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
