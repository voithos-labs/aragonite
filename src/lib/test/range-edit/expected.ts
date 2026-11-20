// What the laws expect, worked out from the source bytes and the host's layout alone, never from the
// package under test: the bytes a copy writes, the bytes a paste at a caret gives, and the bytes a
// new line in a container starts with.

import type { DocumentView, NodeView } from '#lib/core/node-views.js';
import type { Held } from '#lib/range-edit/edit-range.js';
import type { Mode } from '#lib/range-edit/host.js';
import type { LaidBlock, LaidLine, Layout } from '#lib/range-edit/layout.js';
import type { CheckHost } from './test-host';

/** Every line of a container from its first, as the expected answers read them; undefined for a
 *  block with no lines of its own. */
const linesOf = (block: LaidBlock): LaidLine[] | undefined =>
	block.linesIn && [...block.linesIn(block.from)];

export interface Read {
	source: string;
	tree: DocumentView;
	layout: Layout;
	/** Every block, parents before children. */
	blocks: LaidBlock[];
}

export function readOf(host: CheckHost, source: string): Read {
	const tree = host.read(source);
	const layout = host.layout(tree);
	return { source, tree, layout, blocks: [...layout.within(0, Infinity)] };
}

/** The document's line ending: its first. */
export function endingOf(source: string): '\n' | '\r\n' {
	const m = /\r?\n/.exec(source);
	return m ? (m[0] as '\n' | '\r\n') : '\n';
}

export function mixedEndings(source: string): boolean {
	const crlf = (source.match(/\r\n/g) ?? []).length;
	const all = (source.match(/\n/g) ?? []).length;
	return crlf > 0 && crlf < all;
}

export const lf = (text: string) => text.replace(/\r\n/g, '\n');

const MARKED: readonly string[] = ['every-line', 'first-line'];

/** The containers whose own bytes hold `byte`, outermost first; at a container's last byte only
 *  the `end` side counts it. */
export function containersAt(read: Read, byte: number, side: 'start' | 'end'): LaidBlock[] {
	return read.blocks.filter(
		(b) =>
			linesOf(b) !== undefined &&
			(side === 'start' ? b.from <= byte && byte < b.to : b.from < byte && byte <= b.to)
	);
}

/** The containers a caret at `at` sits in: a container's last byte counts when no line ending
 *  closes it there (a document's last line). */
export function containersHolding(read: Read, at: number): LaidBlock[] {
	return read.blocks.filter(
		(b) =>
			linesOf(b) !== undefined &&
			b.from <= at &&
			(at < b.to || (at === b.to && !read.source.slice(b.from, b.to).endsWith('\n')))
	);
}

/** The leaf a caret at `at` sits in, when `at` is inside its text. */
export function leafAt(read: Read, at: number): LaidBlock | null {
	const point = read.layout.pointAt(at);
	const leaf = point && read.blocks.find((b) => b.path.join() === point.path.join());
	if (!leaf?.text || at < leaf.text.from || at > leaf.text.to) return null;
	// Past a text's own last line ending sits the line after it: a code block's closing fence.
	return at === leaf.text.to && read.source[at - 1] === '\n' && at > leaf.text.from ? null : leaf;
}

/** Whether `at` is inside a container's title row. */
export function inTitleRow(read: Read, at: number, host: CheckHost): boolean {
	return read.blocks.some(
		(c) =>
			linesOf(c) &&
			read.blocks.some(
				(row) =>
					row.type === host.facts(c.type).titleRow?.type &&
					row.path.length === c.path.length + 1 &&
					row.from >= c.from &&
					row.to <= c.to &&
					row.from <= at &&
					at <= row.to
			)
	);
}

/** The deepest container both ends sit in; null for the document. */
export function sharedContainer(read: Read, from: number, to: number): LaidBlock | null {
	const ends = new Set(containersAt(read, to, 'end'));
	// A container the range starts at the first byte of keeps its markers in the range's bytes.
	let shared: LaidBlock | null = null;
	for (const b of containersAt(read, from, 'start')) if (ends.has(b) && b.from !== from) shared = b;
	return shared;
}

function lineOf(container: LaidBlock, byte: number): LaidLine {
	return (
		linesOf(container)!.find((l) => l.from <= byte && byte < l.to) ?? linesOf(container)!.at(-1)!
	);
}

const firstBodyLine = (container: LaidBlock) => linesOf(container)!.find((l) => !l.own);

/** The marker `container` writes on `line`, as `source` spells it there. */
const markerOn = (read: Read, line: LaidLine) => read.source.slice(line.from, line.markerTo);

/** What a new line continuing the text at `byte` starts with, through the containers `keep`
 *  allows (the spec's section 5.5). */
export function continuationAt(
	read: Read,
	byte: number,
	host: CheckHost,
	keep: (container: LaidBlock) => boolean = () => true
): string {
	let prefix = '';
	for (const container of containersHolding(read, byte)) {
		if (!keep(container)) break;
		const facts = host.facts(container.type);
		if (!MARKED.includes(facts.lines)) continue;
		const line = lineOf(container, byte);
		if (line.own) continue;
		const source = markerOn(read, line) === '' ? markedFor(read, container, line, facts) : line;
		const marker = source ? markerOn(read, source) : '';
		if (facts.lines === 'first-line' && source === firstBodyLine(container)) {
			prefix += /^[ \t]*\[\^/.test(marker)
				? '    '
				: marker.replace(
						/(^|[\s>])([-*+]|\d{1,9}[.)])(?:[ \t]+\[[ xX]\])?(?=[ \t])/g,
						(_, lead: string, glyph: string) => lead + ' '.repeat(glyph.length)
					);
		} else prefix += marker;
	}
	return prefix;
}

/** A lazy line has no marker, but a new line after it stays in its container: it takes the marker
 *  of the container's nearest marked line. An indented line under a first-line marker isn't lazy. */
function markedFor(
	read: Read,
	container: LaidBlock,
	line: LaidLine,
	facts: { lines: string }
): LaidLine | undefined {
	if (facts.lines === 'first-line' && /^[ \t]/.test(read.source.slice(line.from, line.to)))
		return undefined;
	const lines = linesOf(container)!.filter((l) => !l.own && l.markerTo > l.from);
	return lines.filter((l) => l.from < line.from).at(-1) ?? lines[0];
}

/** The lines a container opens with before its body: an alert's title line, a `:::` line, a
 *  details opener and its summary. */
function openingLines(read: Read, container: LaidBlock, host: CheckHost): string {
	const title = host.facts(container.type).titleRow;
	const row =
		title &&
		read.blocks.find(
			(b) =>
				b.type === title.type &&
				b.path.length === container.path.length + 1 &&
				b.from >= container.from &&
				b.to <= container.to
		);
	if (row) {
		const line = linesOf(container)!.find((l) => l.from <= row.from && row.from < l.to);
		return read.source.slice(container.from, line ? line.to : row.to);
	}
	const first = linesOf(container)!.findIndex((l) => !l.own);
	const lines = first < 0 ? linesOf(container)! : linesOf(container)!.slice(0, first);
	return lines.map((l) => read.source.slice(l.from, l.to)).join('');
}

// ── Copy ─────────────────────────────────────────────────────────────────────

/** The bytes a copy of `[from, to)` writes (the spec's section 5.1). */
export function expectedCopy(read: Read, from: number, to: number, host: CheckHost): string {
	const shared = sharedContainer(read, from, to);
	const depth = shared ? shared.path.length : 0;
	let opening = '';
	for (const container of containersAt(read, from, 'start')) {
		if (container.from >= from || container.path.length <= depth) continue;
		const facts = host.facts(container.type);
		if (facts.lines === 'fenced') opening += openingLines(read, container, host);
		else if (facts.lines === 'every-line') {
			opening += openingLines(read, container, host);
			const line = lineOf(container, from);
			if (!line.own) opening += markerOn(read, line);
		} else if (facts.lines === 'first-line') {
			const first = firstBodyLine(container);
			if (first) opening += markerOn(read, first);
		} else if (facts.lines === 'rows') opening += tableHeadAbove(read, container, shared, from);
	}
	// A fenced block the range enters and ends inside before its closing line is closed around just
	// what it covers, so a copy never opens a fence that swallows what follows it where it's pasted.
	let closing = '';
	const closerOf = (b: LaidBlock) => read.source.lastIndexOf('\n', b.to - 2) + 1;
	const literal = read.blocks.find(
		(b) =>
			b.text &&
			host.facts(b.type).body === 'literal' &&
			from < b.from &&
			b.text.from < to &&
			closesItsFence(treeNodeAt(read.tree, b.path)!.raw) &&
			to <= closerOf(b) &&
			copiesItsFence(read, b, to)
	);
	if (literal) {
		const closerFrom = closerOf(literal);
		const start = shared ? Math.max(closerFrom, lineOf(shared, closerFrom).markerTo) : closerFrom;
		closing += endingOf(read.source) + read.source.slice(start, literal.to).replace(/\r?\n$/, '');
	}
	for (const container of containersAt(read, to, 'end').reverse()) {
		if (container.path.length <= depth || host.facts(container.type).lines !== 'fenced') continue;
		const last = linesOf(container)!.at(-1)!;
		if (!last.own || last.from < to) continue;
		const closer = read.source.slice(last.from, last.to).replace(/\r?\n$/, '');
		closing += endingOf(read.source) + closer;
	}
	return opening + withoutSharedMarkers(read, shared, from, to) + closing;
}

/** A table's header and delimiter lines when `from` sits in a row below them, each line followed by
 *  what `from`'s line holds before it inside `shared`: a copy of its rows still reads as a table. */
function tableHeadAbove(read: Read, table: LaidBlock, shared: LaidBlock | null, from: number) {
	const delimiter = linesOf(table)!.findIndex((line) => line.own);
	if (delimiter < 0 || from < linesOf(table)![delimiter].to) return '';
	const lineStart = read.source.lastIndexOf('\n', from - 1) + 1;
	const inside = shared ? Math.max(lineStart, lineOf(shared, lineStart).markerTo) : lineStart;
	const markers = read.source.slice(inside, from);
	return linesOf(table)!
		.slice(0, delimiter + 1)
		.map((line) => read.source.slice(line.from, line.to) + markers)
		.join('');
}

/** Law 3's third declared exception: a range starting in a table's rows or a container's title row
 *  copies the lines that block opens with, which the removal keeps, so pasted back they repeat. */
export function copiesLinesBeforeRange(
	read: Read,
	from: number,
	host: Pick<CheckHost, 'facts'>
): boolean {
	return read.blocks.some((b) => {
		if (!linesOf(b) || !(b.from < from && from < b.to)) return false;
		const facts = host.facts(b.type);
		if (facts.lines === 'rows') {
			const delimiter = linesOf(b)!.find((line) => line.own);
			return delimiter !== undefined && from >= delimiter.to;
		}
		const row = read.blocks.find(
			(r) =>
				r.type === facts.titleRow?.type &&
				r.path.length === b.path.length + 1 &&
				r.from >= b.from &&
				r.to <= b.to
		);
		const lineEnd = row && read.source.indexOf('\n', row.from);
		return row !== undefined && row.from <= from && (lineEnd! < 0 || from <= lineEnd!);
	});
}

/** Law 3's first declared exception: a range that takes the line a fenced block opens with (a
 *  table's header) and ends inside it, whose opening a plain-text paste can't rebuild. */
export function opensWithoutClosing(
	read: Read,
	from: number,
	to: number,
	host: CheckHost
): boolean {
	return read.blocks.some((b) => {
		if (!(b.from >= from && b.from < to && to < b.to)) return false;
		const lines = host.facts(b.type).lines;
		const fenced = host.facts(b.type).body === 'literal' && !!fenceOf(read, b, host);
		return fenced || lines === 'fenced' || lines === 'rows';
	});
}

/** Law 3's second exception: from a code block's text out past or through its closing line, plain
 *  text can't mark that closer. From a fence the mode shows, its first byte holds the block whole. */
export function leavesLiteralBlock(
	read: Read,
	from: number,
	to: number,
	host: CheckHost,
	mode: Mode
): boolean {
	const leaf = leafAt(read, from);
	if (!leaf || host.facts(leaf.type).body !== 'literal') return false;
	const raw = treeNodeAt(read.tree, leaf.path)!.raw;
	const shown = mode === 'source' || host.facts(leaf.type).textPosition !== 'always';
	if (fenceRun(raw) && from === leaf.from && shown) return false;
	const closer = read.source.lastIndexOf('\n', leaf.to - 2) + 1;
	return to > leaf.to || (closesItsFence(raw) && to > closer);
}

/** Whether some block's text, as the mode shows it, lies partly inside `[from, to)`: in live mode a
 *  fenced code block shows its body alone, and a format run's delimiters show nothing. */
export function holdsShownText(
	read: Read,
	from: number,
	to: number,
	host: CheckHost,
	mode: Mode
): boolean {
	return read.blocks.some((b) => {
		if (!b.text) return false;
		let { from: start, to: end } = b.text;
		const raw = treeNodeAt(read.tree, b.path)!.raw;
		const facts = host.facts(b.type);
		if (mode === 'live' && facts.body === 'literal' && facts.textPosition === 'always') {
			if (fenceRun(raw)) start = read.source.indexOf('\n', b.from) + 1;
			if (closesItsFence(raw)) {
				const closer = read.source.lastIndexOf('\n', b.to - 2);
				end = read.source[closer - 1] === '\r' ? closer - 1 : closer;
			}
		}
		const held = read.source.slice(Math.max(start, from), Math.min(end, to));
		return (mode === 'live' ? held.replace(/[*_~`]/g, '') : held) !== '';
	});
}

/** The run a block's first line opens a fence with (a code, math or diagram fence), read here by
 *  the syntax alone, apart from the host. */
const fenceRun = (raw: string) => /^ {0,3}(`{3,}|~{3,}|\${2,})/.exec(raw)?.[1];

/** Whether a range ending at `to` copies the fence run `b` opens with: a part of the run opens nothing. */
function copiesItsFence(read: Read, b: LaidBlock, to: number): boolean {
	const lineEnd = read.source.indexOf('\n', b.from);
	return (lineEnd >= 0 && to > lineEnd) || !!fenceRun(read.source.slice(b.from, to));
}

/** Whether a block's own bytes, its container's markers off, close the fence they open. */
function closesItsFence(raw: string): boolean {
	const lines = raw.replace(/\r?\n$/, '').split(/\r?\n/);
	const run = fenceRun(raw);
	return !!run && lines.length > 1 && lines.at(-1)!.trim().startsWith(run);
}

/** `[from, to)` with the markers of `shared` and every container around it taken off each line
 *  after the first. */
function withoutSharedMarkers(
	read: Read,
	shared: LaidBlock | null,
	from: number,
	to: number
): string {
	if (!shared) return read.source.slice(from, to);
	let out = '';
	let at = from;
	for (const line of linesOf(shared)!) {
		if (line.to <= from || line.from >= to) continue;
		if (line.from > from) at = Math.max(at, Math.min(line.markerTo, to));
		// A nested container's line runs on to the next line's outer markers; those stay behind.
		const ending = read.source.indexOf('\n', line.from);
		const end = Math.min(ending >= 0 && ending < line.to ? ending + 1 : line.to, to);
		if (end > at) out += read.source.slice(at, end);
		at = end;
	}
	return out;
}

// ── Law 3's comparison ───────────────────────────────────────────────────────

/** Whether `back` is `source` with only the covered lines' marker spellings changed: the bytes
 *  around those lines exact, and the same blocks, text and container title lines between. */
export function sameDocument(
	host: CheckHost,
	source: string,
	back: string,
	from: number,
	to: number
): boolean {
	const head = source.slice(0, source.lastIndexOf('\n', from - 1) + 1);
	const breakAt = source.indexOf('\n', to);
	const tail = breakAt < 0 ? '' : source.slice(breakAt + 1);
	if (!back.startsWith(head) || !back.endsWith(tail) || back.length < head.length + tail.length)
		return false;
	return sameBlocks(host, source, back);
}

/** Whether two sources read as the same blocks holding the same text, spellings aside. */
export function sameBlocks(host: CheckHost, a: string, b: string): boolean {
	return shapeOf(host, a) === shapeOf(host, b);
}

function shapeOf(host: CheckHost, source: string): string {
	type Node = NodeView;
	// Strings in a node's metadata spell its markers; its flags (ordered, checked, open) are its own.
	const flags = (n: Node) => Object.values(n.metadata ?? {}).filter((v) => typeof v === 'boolean');
	const trimmed = (text: string) =>
		lf(text)
			.split('\n')
			.map((l) => l.trim())
			.join('\n')
			.trimEnd();
	const shape = (n: Node): unknown =>
		n.children?.length
			? [n.kind, flags(n), n.children.map(shape)]
			: [n.kind, flags(n), trimmed(n.raw)];
	const read = readOf(host, source);
	// A container's own lines (`:::note Title`, `> [!NOTE]`, a summary) name it.
	const titles = read.blocks.flatMap((b) =>
		(linesOf(b) ?? []).filter((l) => l.own).map((l) => trimmed(source.slice(l.from, l.to)))
	);
	const blocks = read.tree.children.filter((n) => !(n.kind === 'paragraph' && n.raw.trim() === ''));
	return JSON.stringify([blocks.map(shape), titles]);
}

/** In live mode, whether an end of the range falls inside a format run, which the carried bytes
 *  close on both sides, so a paste back can't give the bytes back. */
export function liveSplitsRun(read: Read, from: number, to: number, host: CheckHost): boolean {
	return [from, to].some((byte) => {
		const point = read.layout.pointAt(byte);
		const leaf = point && read.blocks.find((b) => b.path.join() === point.path.join());
		if (!point || !leaf?.text) return false;
		const end = read.layout.pointAt(leaf.text.to);
		if (!end || end.path.join() !== point.path.join()) return false;
		const plain = (a: number, b: number) =>
			read.source.slice(read.layout.byteOf(point.path, a)!, read.layout.byteOf(point.path, b)!);
		const carried = (a: number, b: number) =>
			host.leaf.carried(read.tree, point.path, a, b, 'live');
		return (
			carried(0, point.offset) !== plain(0, point.offset) ||
			carried(point.offset, end.offset) !== plain(point.offset, end.offset)
		);
	});
}

// ── Paste at a caret ─────────────────────────────────────────────────────────

/** Which rule a clipboard lands by at a caret: one paragraph of text; blocks joined to the text
 *  either side; a leading container taken in by one the caret sits in; a leading list splitting the
 *  list of another kind it leaves; a leading block of its own kind splitting a paragraph; or a
 *  shape the rows hold. */
export type PasteShape =
	| 'text'
	| 'blocks'
	| 'absorbed'
	| 'broken out'
	| 'split'
	/** At a place in no block's text: blocks of their own between the blocks there. */
	| 'apart'
	/** On an empty line no block holds, a heading's that gave way too: blocks of their own there. */
	| 'on a line'
	| 'other';

/** The source a paste of `text` at `at`, a caret holding what `held` says, may give, with the rule
 *  that gives it. With `to`, a list that breaks out lands over `[at, to)` of the caret's text. */
export function expectedPaste(
	read: Read,
	at: number,
	text: string,
	host: CheckHost,
	held: Held,
	to = at
): { shape: PasteShape; bytes: string[] } {
	// Where a block starts and the caret is in no text, the clipboard lands above it all the same.
	const rest = read.source.slice(at, (read.source + '\n').indexOf('\n', at));
	const onSyntax =
		!leafAt(read, at) && rest.trim() !== '' && read.blocks.some((b) => b.from === at);
	// On an empty line no block holds it lands as blocks of its own, apart where two read as one.
	const head = read.source.slice(read.source.lastIndexOf('\n', at - 1) + 1, at);
	const onEmptyLine = !leafAt(read, at) && rest.trim() === '' && /^[ \t>]*$/.test(head);
	if (held.holds !== 'text' || onSyntax || onEmptyLine) {
		const bytes =
			held.holds === 'text'
				? landedApart(read, at, lf(text), host)
				: landedInGap(read, at, held.parent, lf(text), host);
		const shape = held.holds === 'text' && !onSyntax ? 'on a line' : 'apart';
		return bytes === null ? { shape: 'other', bytes: [] } : { shape, bytes };
	}
	// A top-level heading with no text gives way to blocks that join none of it: they land on its
	// line as on an empty one.
	const leaf = leafAt(read, at);
	const firstPasted = readOf(host, lf(text)).blocks.find(
		(b) => b.path.length === 1 && lf(text).slice(b.from, b.to).trim() !== ''
	);
	const emptied =
		at === to &&
		leaf?.path.length === 1 &&
		leaf.from < leaf.text!.from &&
		leaf.text!.from === leaf.text!.to &&
		!!firstPasted &&
		firstPasted.type !== 'paragraph' &&
		!lf(text).startsWith('\n');
	if (emptied) {
		const end = lineContentEnd(read.source, leaf.to);
		const bare = readOf(host, read.source.slice(0, leaf.from) + read.source.slice(end));
		return expectedPaste(bare, leaf.from, text, host, held);
	}
	const want = structuredPaste(read, at, to, text, host);
	const last = host
		.read(lf(text))
		.children.filter((b) => b.raw.trim() !== '')
		.at(-1);
	const container = !!last?.children?.length;
	const apart = (bytes: string) => apartBelow(read, at, bytes, host, container);
	const joined = (bytes: string) => joinedLists(read, at, bytes, readOf(host, lf(text)), host);
	return { ...want, bytes: want.bytes.flatMap(apart).map(joined) };
}

/** Whether `byte` is where a later line of `leaf`'s own bytes starts: a paste's cut there ends the
 *  first half before the line break above, as a split does. */
export function startsLaterLine(read: Read, leaf: LaidBlock, byte: number): boolean {
	const offset = read.layout.pointAt(byte)?.offset ?? 0;
	return byte > leaf.text!.from && treeNodeAt(read.tree, leaf.path)?.raw[offset - 1] === '\n';
}

/** `source` up to the line break over the line holding `byte`, that break left out. */
export const aboveLine = (source: string, byte: number) =>
	source.slice(0, source.lastIndexOf('\n', byte - 1) + 1).replace(/\r?\n$/, '');

/** The bytes a paste over `block` keeps above it: up to its line's start, where a blank line may
 *  go in, or to the end of the list above where a pasted list of its own type joins that list. */
export function overEmptied(read: Read, block: LaidBlock, text: string, host: CheckHost): string {
	const clip = readOf(host, lf(text));
	const first = clip.blocks.find(
		(b) => b.path.length === 1 && clip.source.slice(b.from, b.to).trim() !== ''
	);
	const over = [...block.path.slice(0, -1), block.path.at(-1)! - 1].join();
	const upper = read.blocks.find((b) => b.path.join() === over);
	const joins = sameList(read, upper, clip, first, true, host);
	const line = read.source.lastIndexOf('\n', block.from - 1) + 1;
	return read.source.slice(0, joins ? upper!.to : line);
}

/** What keeps two lists apart: an item's bullet character, or its ordered delimiter. */
function markerFamily(read: Read, list: LaidBlock | undefined, last: boolean): string | null {
	const items = read.blocks.filter(
		(b) =>
			b.path.length === list!.path.length + 1 && b.path.slice(0, -1).join() === list!.path.join()
	);
	const item = last ? items.at(-1) : items[0];
	const marker = item && /^[ \t>]*(?:([-+*])|\d+([.)]))/.exec(read.source.slice(item.from));
	return marker ? (marker[1] ?? marker[2]) : null;
}

/** Whether `pasted`, a block of `clip`, is a list of the type of `list` beside it in `read`, so the
 *  two join as items: `under` where the pasted one is the lower. */
function sameList(
	read: Read,
	list: LaidBlock | undefined,
	clip: Read,
	pasted: LaidBlock | undefined,
	under: boolean,
	host: CheckHost
): boolean {
	if (!list || pasted?.type !== list.type || host.facts(list.type).lines !== 'items') return false;
	const family = markerFamily(read, list, under);
	return family !== null && family === markerFamily(clip, pasted, !under);
}

/** `bytes`, a paste of `clip` into the empty paragraph at `at`, with a pasted list joined to a list
 *  of its own type either side of that paragraph: no blank line stands between items of one list. */
function joinedLists(read: Read, at: number, bytes: string, clip: Read, host: CheckHost): string {
	const target = leafAt(read, at);
	const empty = !!target && /^\r?\n?$/.test(treeNodeAt(read.tree, target.path)?.raw ?? '-');
	if (target?.type !== 'paragraph' || !empty || inTitleRow(read, at, host)) return bytes;
	const tops = clip.blocks.filter(
		(b) => b.path.length === 1 && clip.source.slice(b.from, b.to).trim() !== ''
	);
	const beside = (step: number) =>
		read.blocks.find(
			(b) => b.path.join() === [...target.path.slice(0, -1), target.path.at(-1)! + step].join()
		);
	const lineOf = (source: string, byte: number) => source.lastIndexOf('\n', byte - 1) + 1;
	const joins = (list: LaidBlock | undefined, pasted: LaidBlock | undefined, under: boolean) =>
		sameList(read, list, clip, pasted, under, host);
	let out = bytes;
	const [upper, lower] = [beside(-1), beside(1)];
	const flush = !!lower && lineOf(read.source, lower.from) === target.to;
	if (flush && joins(lower, tops.at(-1), false)) {
		const line = target.to + bytes.length - read.source.length;
		const above = lineOf(out, line - 1);
		if (/^[ \t>]*\r?\n$/.test(out.slice(above, line))) out = out.slice(0, above) + out.slice(line);
	}
	if (joins(upper, tops[0], true))
		out = out.slice(0, upper!.to) + out.slice(lineOf(read.source, target.from));
	return out;
}

/** `bytes`, or `bytes` with a blank line over the block flush under an empty paragraph the paste
 *  landed in: required where only that keeps the block starting its line. */
export function apartBelow(
	read: Read,
	at: number,
	bytes: string,
	host: CheckHost,
	pastedContainer = false
): string[] {
	const target = leafAt(read, at);
	const empty = !!target && /^\r?\n?$/.test(treeNodeAt(read.tree, target.path)?.raw ?? '-');
	if (target?.type !== 'paragraph' || !empty || inTitleRow(read, at, host)) return [bytes];
	// A pasted container the caret's container takes in is that block's own, set apart from nothing.
	if (pastedContainer) return [bytes];
	const lineEnd = read.source.indexOf('\n', target.to);
	const lineBelow = read.source.slice(target.to, lineEnd < 0 ? undefined : lineEnd);
	if (/^[ \t>]*\r?$/.test(lineBelow)) return [bytes];
	const textStart = target.to + /^[ \t>]*/.exec(lineBelow)![0].length;
	const sibling = [...target.path.slice(0, -1), target.path.at(-1)! + 1].join();
	const next = read.blocks.find((b) => b.path.join() === sibling && b.from <= textStart);
	if (!next) return [bytes];
	const shift = bytes.length - read.source.length;
	const line = target.to + shift;
	const marks = read.source.slice(target.to, next.from).trimEnd() + endingOf(read.source);
	const apart = bytes.slice(0, line) + marks + bytes.slice(line);
	// The block starts on the line of `from`: spaces before it there may be its own or the line's.
	const lineOf = (source: string, byte: number) => source.lastIndexOf('\n', byte - 1);
	const starts = (source: string, from: number) =>
		readOf(host, source).blocks.some(
			(b) => b.type === next.type && lineOf(source, b.from) === lineOf(source, from)
		);
	if (starts(bytes, next.from + shift)) return [bytes, apart];
	return starts(apart, next.from + shift + marks.length) ? [apart] : [bytes];
}

/** `clip` between the children of the block at `parent`, on lines of its own, a blank line between
 *  it and the block either side; past the last child the place is the parent's end. */
function landedInGap(
	read: Read,
	at: number,
	parent: readonly number[],
	clip: string,
	host: CheckHost
): string[] | null {
	const { source } = read;
	const eol = endingOf(source);
	if (readOf(host, clip).blocks.every((b) => clip.slice(b.from, b.to).trim() === '')) return null;
	const holder = read.blocks.find((b) => parent.length > 0 && b.path.join() === parent.join());
	if (parent.length > 0 && !(holder && linesOf(holder))) return null;
	// Among a table's rows no block stands, and between a list's items the rows hold what lands.
	const shape = holder ? host.facts(holder.type).lines : 'none';
	if (shape === 'rows' || shape === 'items') return null;
	const closer = (holder && linesOf(holder))?.at(-1);
	const closed = shape === 'fenced' && linesOf(holder!)!.length > 1 && closer!.own;
	const end = !holder ? source.length : closed ? closer!.from : holder.to;
	const past = at >= end;
	const place = past ? end : at;
	const inside = (c: LaidBlock) =>
		c.path.length <= parent.length && c.path.every((p, i) => p === parent[i]);
	const prefix = continuationAt(read, past ? Math.max(place - 1, 0) : place, host, inside);
	const lineStart = (bytes: string, byte: number) => bytes.lastIndexOf('\n', byte - 1) + 1;
	const head = source.slice(lineStart(source, place), place);
	const marked = /^[ \t>]*$/.test(head);
	// The first line takes the markers its line lacks; after a last line with no ending, a new line.
	const reached = prefix.startsWith(head) ? prefix.slice(head.length) : '';
	const lead = marked ? reached : past ? eol + prefix : '';
	const follows = past ? place < source.length : !nothingVisibleAfter(source, place);
	const lines = (follows ? clip.replace(/\n$/, '') : clip).split('\n');
	const pasted = lead + join(lines, prefix, eol, follows && !past);
	const under = past ? (marked ? head : '') : prefix;
	let out = source.slice(0, place) + pasted + (follows ? eol + under : '') + source.slice(place);
	const blank = (bytes: string, line: number) =>
		/^[ \t>]*\r?$/.test(bytes.slice(line, (bytes + '\n').indexOf('\n', line)));
	// Under it: whatever line follows, save one that closes a container.
	const stop = place + pasted.length;
	const below = out.indexOf('\n', stop) + 1;
	const next = follows ? place : source.indexOf('\n', place) + 1;
	const closes = read.blocks.some((c) => {
		const last = linesOf(c)?.at(-1);
		const text = next + /^[ \t>]*/.exec(source.slice(next))![0].length;
		return !!last && linesOf(c)!.length > 1 && last.own && last.from <= text && text < last.to;
	});
	if (below > 0 && !blank(out, below) && !blank(out, lineStart(out, stop)) && !closes)
		out = out.slice(0, below) + under.trimEnd() + eol + out.slice(below);
	// Over it: the child of the parent that ends where the place's line starts, a title row aside.
	const title = holder && host.facts(holder.type).titleRow?.type;
	const over = read.blocks.findLast(
		(b) =>
			b.path.length === parent.length + 1 &&
			b.path.slice(0, -1).join() === parent.join() &&
			b.to <= place &&
			b.type !== title
	);
	const first = lineStart(out, place + lead.length);
	const apart = first === 0 || blank(out, lineStart(out, first - 1)) || blank(out, first);
	const flush = !!over && over.to >= lineStart(source, place) && (marked || past);
	if (!flush || apart) return [out];
	const marks = out.slice(first, place + lead.length).trimEnd();
	return [out.slice(0, first) + marks + eol + out.slice(first)];
}

/** `clip` at `at`, a place in no block's text, on lines of its own above what follows `at` on its
 *  line: a blank line either side only where a block there reads as its own with it and not without. */
function landedApart(read: Read, at: number, clip: string, host: CheckHost): string[] | null {
	const { source } = read;
	const eol = endingOf(source);
	const tops = readOf(host, clip).blocks.filter(
		(b) => b.path.length === 1 && clip.slice(b.from, b.to).trim() !== ''
	);
	if (tops.length === 0) return null;
	// A container holds the place once its marker on the place's line has ended.
	const holds = (c: LaidBlock) => c.from < at && lineOf(c, at).markerTo <= at;
	const around = containersHolding(read, at).filter(holds);
	// Among a table's rows no block stands, and between a list's items the rows hold what lands.
	const parts = around.at(-1) && host.facts(around.at(-1)!.type).lines;
	if (parts === 'rows' || parts === 'items') return null;
	const depth = (around.at(-1)?.path.length ?? 0) + 1;
	const prefix = continuationAt(read, at, host, holds);
	const follows = !nothingVisibleAfter(source, at);
	// The line break that sets what follows on its own line stands for the clipboard's last one.
	const lines = (follows ? clip.replace(/\n$/, '') : clip).split('\n');
	const pasted = join(lines, prefix, eol, follows);
	const out = source.slice(0, at) + pasted + (follows ? eol + prefix : '') + source.slice(at);
	const lineStart = (bytes: string, byte: number) => bytes.lastIndexOf('\n', byte - 1) + 1;
	// A block starts on the line of `byte`: spaces before it there may be its own or the line's.
	const starts = (bytes: string, type: string, byte: number) =>
		readOf(host, bytes).blocks.some(
			(b) =>
				b.type === type &&
				b.path.length === depth &&
				lineStart(bytes, b.from) === lineStart(bytes, byte)
		);
	// `bytes`, or `bytes` with a blank line behind `marks` over the line of `byte`: the one where a
	// block of `type` starts there, or either where both do, as the core asks of the two blocks alone.
	const parted = (bytes: string, byte: number, type: string, marks: string) => {
		const line = lineStart(bytes, byte);
		const above = bytes.slice(lineStart(bytes, line - 1), line);
		if (line === 0 || /^[ \t>]*\r?\n$/.test(above)) return [bytes];
		const blank = marks.trimEnd() + eol;
		const apart = bytes.slice(0, line) + blank + bytes.slice(line);
		const [flush, set] = [starts(bytes, type, byte), starts(apart, type, byte + blank.length)];
		return flush && set ? [bytes, apart] : set ? [apart] : [bytes];
	};
	// The blocks either side: children of the container around the place, a title row left out.
	const holder = around.at(-1);
	const beside = read.blocks.filter(
		(b) =>
			b.path.length === depth &&
			source.slice(b.from, b.to).trim() !== '' &&
			(!holder || (b.from >= holder.from && b.to <= holder.to))
	);
	// A pasted list joins a list of its own type either side as items, no blank line between.
	const clipRead = readOf(host, clip);
	const under = beside.find((b) => b.from >= at);
	const below =
		under && !sameList(read, under, clipRead, tops.at(-1), false, host)
			? parted(out, under.from + out.length - source.length, under.type, prefix)
			: [out];
	// Past where its line's text starts, the place is on a line of the block above, never under it.
	const head = lineStart(source, at);
	const textStart = holder ? lineOf(holder, at).markerTo : head;
	const over = beside.find((b) => b.to >= head && b.to <= at && !inTitleRow(read, b.from, host));
	if (!over || at !== textStart || sameList(read, over, clipRead, tops[0], true, host))
		return below;
	return below.flatMap((bytes) => parted(bytes, at, tops[0].type, source.slice(head, at)));
}

const lineContentEnd = (source: string, to: number) =>
	to - (source.slice(to - 2, to) === '\r\n' ? 2 : source[to - 1] === '\n' ? 1 : 0);

/** `landedPaste` in a block with structure past its text (an underline, a closing `#` run): the
 *  paste lands as without it, and the structure ends the block still starting where the caret's did. */
function structuredPaste(
	read: Read,
	at: number,
	to: number,
	text: string,
	host: CheckHost
): { shape: PasteShape; bytes: string[] } {
	const leaf = leafAt(read, at);
	const end = leaf ? lineContentEnd(read.source, leaf.to) : 0;
	if (!leaf?.text || leaf.text.to >= end) return landedPaste(read, at, to, text, host);
	const other = { shape: 'other' as const, bytes: [] };
	const structure = read.source.slice(leaf.text.to, end);
	if (structure.trim() === '') return landedPaste(read, at, to, text, host);
	const bare = readOf(host, read.source.slice(0, leaf.text.to) + read.source.slice(end));
	const same = bare.blocks.find((b) => b.from === leaf.from && b.text?.to === leaf.text!.to);
	if (!same) return other;
	const want = landedPaste(bare, at, to, text, host, endingOf(read.source));
	const bytes: string[] = [];
	for (const landed of want.bytes) {
		const head = readOf(host, landed).blocks.find((b) => b.from === leaf.from && b.text);
		if (!head) return other;
		const stop = lineContentEnd(landed, head.to);
		// A line the structure takes ends as it did, or as the document's new lines do.
		const moved = structure.replace(/^\r?\n/, endingOf(read.source));
		for (const written of new Set([structure, moved]))
			bytes.push(landed.slice(0, stop) + written + landed.slice(stop));
	}
	return { shape: want.shape, bytes };
}

/** Whether the caret at `at` is in a table cell's text. */
export function cellAt(read: Read, at: number, host: CheckHost): boolean {
	const leaf = leafAt(read, at);
	const row = leaf && read.blocks.find((b) => b.path.join() === leaf.path.slice(0, -1).join());
	return !!row && host.facts(row.type).lines === 'cells';
}

/** `CheckHost.liveCut` for the caret at `at`: what a live split does with the constructs it
 *  sits in. */
export function liveCutAt(read: Read, at: number, host: CheckHost): 'whole' | 'literal' | null {
	const around = markdownTextAt(read, at, host);
	return around && host.liveCut(around.text, around.offset);
}

/** The Markdown text of the block the caret at `at` is in, and the caret's offset in it. */
function markdownTextAt(read: Read, at: number, host: CheckHost) {
	const point = read.layout.pointAt(at);
	const leaf = point && read.blocks.find((b) => b.path.join() === point.path.join());
	if (!point || !leaf?.text || host.facts(leaf.type).body !== 'markdown') return null;
	const start = read.layout.pointAt(leaf.text.from)!.offset;
	const end = read.layout.pointAt(leaf.text.to)!.offset;
	const raw = treeNodeAt(read.tree, leaf.path)!.raw;
	return { text: raw.slice(start, end), offset: point.offset - start };
}

/** Whether the caret at `at` stands inside an inline construct of a Markdown text block. */
export function inConstructAt(read: Read, at: number, host: CheckHost): boolean {
	const around = markdownTextAt(read, at, host);
	return !!around && host.heldAt(around.text, around.offset);
}

/** Whether no marker opens the half a live cut at `at` leaves behind `lead`, a pasted line ending
 *  on a letter: the half starts on punctuation, or its run sits in a run of its own kind. */
export function reopensNowhere(read: Read, at: number, lead: string, host: CheckHost): boolean {
	const around = markdownTextAt(read, at, host);
	if (!around || !/[\p{L}\p{N}]$/u.test(lead)) return false;
	const runs = host.runsAt(around.text, around.offset);
	const onPunctuation = /^[^\p{L}\p{N}\s]/u.test(around.text.slice(around.offset));
	return runs.length > 0 && (onPunctuation || new Set(runs).size < runs.length);
}

/** How many format delimiters the Markdown text blocks of `source` show in live mode: a run left
 *  open shows its own, a closed run hides them. */
export function shownDelimiters(host: CheckHost, source: string): number {
	const read = readOf(host, source);
	let shown = 0;
	for (const block of read.blocks) {
		if (!block.text || host.facts(block.type).body !== 'markdown') continue;
		const [from, to] = [read.layout.pointAt(block.text.from), read.layout.pointAt(block.text.to)];
		const raw = treeNodeAt(read.tree, block.path)?.raw;
		if (!from || !to || raw === undefined) continue;
		const text = host.shows(raw.slice(from.offset, to.offset), 'live');
		shown += text.match(/[*_~`[\]]/g)?.length ?? 0;
	}
	return shown;
}

function landedPaste(
	read: Read,
	at: number,
	to: number,
	text: string,
	host: CheckHost,
	eol = endingOf(read.source)
): { shape: PasteShape; bytes: string[] } {
	const clip = readOf(host, lf(text));
	const tops = clip.blocks.filter(
		(b) =>
			b.path.length === 1 &&
			!(b.type === 'paragraph' && clip.source.slice(b.from, b.to).trim() === '')
	);
	const first = tops[0];
	const last = tops.at(-1);
	const lastJoins = !last || host.facts(last.type).joins !== 'never';
	const after = !nothingVisibleAfter(read.source, at);
	const lines = clip.source.split('\n');
	const variants = (write: (ls: string[]) => string) => [write(lines)];
	const splice = (prefix: string, head: string) => (ls: string[]) =>
		read.source.slice(0, at) + head + join(ls, prefix, eol, after) + read.source.slice(at);

	const target = leafAt(read, at);
	if (!target || host.facts(target.type).textPosition === 'never')
		return { shape: 'other', bytes: [] };
	const targetFacts = host.facts(target.type);
	const title = titleLine(read, at, target, lf(text), host);
	if (title !== null)
		return { shape: 'text', bytes: [read.source.slice(0, at) + title + read.source.slice(at)] };
	// Literal text (code) takes the paste as written, whatever it would read as elsewhere.
	if (targetFacts.body === 'literal') {
		const prefix = literalPrefix(read, at, target, lf(text), host);
		if (prefix === null) return { shape: 'other', bytes: [] };
		return { shape: 'text', bytes: variants(splice(prefix, '')) };
	}
	// A clipboard opening with a line break at a heading's text start: the heading moves with its
	// text as a split moves it, bytes the rows hold.
	if (lines[0] === '' && at === target.text!.from && target.from < at)
		return { shape: 'other', bytes: [] };
	// One line after text on the caret's line goes in as text, whatever it reads as alone.
	const rowFrom = Math.max(read.source.lastIndexOf('\n', at - 1) + 1, target.text!.from);
	const textBefore = read.source.slice(rowFrom, at).replace(/^[ \t>]*/, '') !== '';
	const oneLine = !clip.source.includes('\n') && textBefore;
	if (!first || oneLine || (tops.length === 1 && first.type === 'paragraph')) {
		return { shape: 'text', bytes: variants(splice(continuationAt(read, at, host), '')) };
	}
	if (first.type === 'paragraph' && lastJoins) {
		return { shape: 'blocks', bytes: variants(splice(continuationAt(read, at, host), '')) };
	}
	const left = listLeft(read, at, clip, first, target, host);
	if (left) {
		const outside = continuationAt(read, at, host, (c) => c !== left);
		const out = brokenOut(read, at, to, left, target, clip.source, eol, outside, host);
		return out === null ? { shape: 'other', bytes: [] } : { shape: 'broken out', bytes: [out] };
	}
	const taker = takerOf(read, at, clip, first, host);
	if (taker && host.facts(first.type).lines !== 'fenced' && lastJoins) {
		const outside = continuationAt(read, at, host, (c) => c !== taker);
		// The block's own opening (its marker, a title line) is the taker's already.
		const firstText = clip.blocks.find((b) => b.text && b.from >= first.from)?.text?.from;
		const rest = clip.source.slice(firstText ?? first.from).split('\n');
		return {
			shape: 'absorbed',
			bytes: [read.source.slice(0, at) + join(rest, outside, eol, after) + read.source.slice(at)]
		};
	}
	const point = read.layout.pointAt(at);
	const leaf = point && read.blocks.find((b) => b.path.join() === point.path.join());
	if (leaf?.type === 'paragraph' && leaf.text && at > leaf.text.from && lastJoins) {
		const prefix = continuationAt(read, at, host);
		// A blank line before the pasted block, or one line break where that alone reads it apart.
		const line = splice(prefix, eol + prefix)(lines);
		const startsAt = at + eol.length + prefix.length;
		const own = readOf(host, line).blocks.some((b) => b.type === first.type && b.from === startsAt);
		// A clipboard that opens with its own line break already stands for that separation, and a
		// caret line holding only spaces is a blank line already (§ 5.4 rule 6, ruled 2026-11-06).
		if (lines[0] === '') return { shape: 'split', bytes: [splice(prefix, '')(lines)] };
		if (read.source.slice(leaf.text.from, at).trim() === '')
			return { shape: 'split', bytes: [line] };
		// At a later line's start the line break above ends the first half, as a split leaves it:
		// one blank line under it, then the pasted block behind the markers a new line takes there.
		if (startsLaterLine(read, leaf, at)) {
			const head = aboveLine(read.source, at) + eol + prefix.trimEnd() + eol + prefix;
			return {
				shape: 'split',
				bytes: [head + join(lines, prefix, eol, after) + read.source.slice(at)]
			};
		}
		const blank = splice(prefix, eol + prefix.trimEnd() + eol + prefix)(lines);
		return { shape: 'split', bytes: own ? [blank, line] : [blank] };
	}
	return { shape: 'other', bytes: [] };
}

/** The fence around `leaf`'s text, by the host's grammar; null for a block with none. */
export const fenceOf = (read: Read, leaf: LaidBlock, host: CheckHost) =>
	host.fence(treeNodeAt(read.tree, leaf.path)!.raw);

/** What a later line pasted into literal text at `at` starts with: its containers' markers and,
 *  with no fence around it, the caret line's indent. Null where a line could close the fence. */
function literalPrefix(
	read: Read,
	at: number,
	leaf: LaidBlock,
	text: string,
	host: CheckHost
): string | null {
	const raw = treeNodeAt(read.tree, leaf.path)!.raw;
	const fence = fenceOf(read, leaf, host);
	if (fence && text.split('\n').some((line) => fence.mayClose(line))) return null;
	const offset = read.layout.pointAt(at)!.offset;
	const line = raw.slice(raw.lastIndexOf('\n', offset - 1) + 1, offset);
	return continuationAt(read, at, host) + (fence ? '' : /^[ \t]*/.exec(line)![0]);
}

const oneLine = (text: string) => text.replace(/\n+$/, '').replace(/\n+/g, ' ');

/** A paste of `text` into title row `row` at `at`, as the one line it holds: a run of line breaks
 *  is one space, and at the end of the row's name a space sets the title off. Null off a title row. */
function titleLine(
	read: Read,
	at: number,
	row: LaidBlock,
	text: string,
	host: CheckHost
): string | null {
	const owner = read.blocks.find(
		(b) =>
			linesOf(b) &&
			host.facts(b.type).titleRow?.type === row.type &&
			b.from <= row.from &&
			row.to <= b.to
	);
	if (!owner) return null;
	const flat = oneLine(text);
	const atName =
		host.facts(owner.type).titleRow!.nameNeverEntered &&
		at === row.text!.from &&
		/\S/.test(read.source[at - 1] ?? ' ');
	return atName && flat !== '' ? ' ' + flat : flat;
}

/** The deepest container at `at` a pasted leading block of `type` merges into. */
function takerOf(
	read: Read,
	at: number,
	pasted: Read,
	first: LaidBlock,
	host: CheckHost
): LaidBlock | null {
	const { into, key } = host.facts(first.type).merges;
	let taker: LaidBlock | null = null;
	for (const c of containersHolding(read, at)) {
		if (into.includes(c.type) && sharedBy(read, c, key) === sharedBy(pasted, first, key)) taker = c;
	}
	return taker;
}

/** What two containers of a type must share to merge, as `block` holds it. */
const sharedBy = (read: Read, block: LaidBlock, key: string | undefined) =>
	key
		? (treeNodeAt(read.tree, block.path)?.metadata as Record<string, unknown> | undefined)?.[key]
		: undefined;

/** The list a pasted leading list of the other kind breaks out of (C8): the nearest of its type at
 *  `at`, with the caret's block `target` an item's own and not nested deeper. */
function listLeft(
	read: Read,
	at: number,
	pasted: Read,
	first: LaidBlock,
	target: LaidBlock,
	host: CheckHost
): LaidBlock | null {
	const { into, key, onMismatch } = host.facts(first.type).merges;
	const nearest = containersHolding(read, at)
		.filter((c) => into.includes(c.type))
		.at(-1);
	if (!nearest || onMismatch !== 'break-out' || target.path.length !== nearest.path.length + 2)
		return null;
	return sharedBy(read, nearest, key) === sharedBy(pasted, first, key) ? null : nearest;
}

/** The bytes `clip` lands as in the column of `list`, between its halves split at `at`, the second
 *  from `to` on and numbered on; null where a number would change width, which the rows hold. */
function brokenOut(
	read: Read,
	at: number,
	to: number,
	list: LaidBlock,
	target: LaidBlock,
	clip: string,
	eol: string,
	outside: string,
	host: CheckHost
): string | null {
	const { source } = read;
	const itemOf = (path: readonly number[]) =>
		read.blocks.find((b) => b.path.join() === path.join());
	const item = itemOf(target.path.slice(0, -1))!;
	const first = linesOf(item)![0];
	const whole = at === target.text!.from && target.path.at(-1) === 0;
	const spaces = (line: string) => line.search(/[^ ]|$/);
	const written = clip.replace(/\n$/, '').split('\n');
	const brought = spaces(written.find((line) => line !== '')!);
	const lines = written.map((line) => line.slice(Math.min(brought, spaces(line))));
	const indent = /^[ \t]*/.exec(source.slice(first.from, at))![0];
	const pasted =
		(lines[0] === '' ? '' : indent) +
		join(lines, outside + indent, eol, !nothingVisibleAfter(source, to));
	// At a later line's start the first half ends before the line break above, as a split's does.
	const upTo = startsLaterLine(read, target, at) ? aboveLine(source, at) : source.slice(0, at);
	const head = whole ? source.slice(0, first.from) + pasted : upTo + eol + outside + pasted;
	// A side with no text makes no item: an item emptied both sides gives way, the rest numbered on.
	const held = source.slice(to, item.to).trim() !== '';
	const tail = !whole && held;
	const gone = whole && !held;
	const digits = /^([ \t]*)(\d+)/.exec(source.slice(first.from, first.markerTo));
	let rest = source.slice(to);
	const index = item.path.at(-1)!;
	const count = treeNodeAt(read.tree, list.path)!.children!.length;
	for (let i = count - 1; digits && (!whole || gone) && i > index; i--) {
		const line = linesOf(itemOf([...list.path, i])!)![0];
		const own = /^([ \t]*)(\d+)/.exec(source.slice(line.from, line.markerTo));
		const want = String(Number(digits[2]) + i - index + (tail ? 1 : 0) - (gone ? 1 : 0));
		if (!own) continue;
		if (own[2].length !== want.length) return null;
		const from = line.from + own[1].length - to;
		rest = rest.slice(0, from) + want + rest.slice(from + own[2].length);
	}
	let marker = whole ? source.slice(first.from, at) : source.slice(first.from, first.markerTo);
	if (digits && tail) {
		const want = String(Number(digits[2]) + 1);
		if (want.length !== digits[2].length) return null;
		marker = digits[1] + want + marker.slice(digits[0].length);
	}
	const second = held ? eol + outside + marker : '';
	const flush = head + second + rest;
	const under = flush.indexOf('\n', head.length) + 1;
	if (under === 0 || (source.slice(to).trim() === '' && !whole)) return flush;
	// A blank line under the pasted blocks, or one they end on, parts them already.
	const lineEnd = flush.indexOf('\n', under);
	const stop = lineEnd < 0 ? flush.length : lineEnd;
	const above = flush.slice(flush.lastIndexOf('\n', under - 2) + 1, under);
	if (/^[ \t>]*\r?$/.test(flush.slice(under, stop)) || /^[ \t>]*\r?\n$/.test(above)) return flush;
	// Under them stands the list's second half, a list of its own; or, where no item is left to be
	// one, the block that stood under the list, which still starts its line outside the pasted ones.
	const last = !held && index === count - 1;
	const starts = readOf(host, flush).blocks.some((b) =>
		last
			? b.path.length <= list.path.length && b.from >= under && b.from < stop
			: b.type === list.type &&
				b.path.length === list.path.length &&
				b.from === under + outside.length
	);
	return starts ? flush : flush.slice(0, under) + outside.trimEnd() + eol + flush.slice(under);
}

function treeNodeAt(tree: DocumentView, path: readonly number[]) {
	let nodes = tree.children;
	let node: NodeView | undefined;
	for (const i of path) {
		node = nodes[i];
		if (!node) return undefined;
		nodes = node.children ?? [];
	}
	return node;
}

/** The lines joined, each after the first behind `prefix`; a blank one takes the prefix without its
 *  trailing spaces unless the caret's own text follows it. */
function join(lines: string[], prefix: string, eol: string, after: boolean): string {
	return lines
		.map((line, i) => {
			if (i === 0) return line;
			const blank = line === '' && !(i === lines.length - 1 && after);
			return (blank ? prefix.trimEnd() : prefix) + line;
		})
		.join(eol);
}

function nothingVisibleAfter(source: string, byte: number): boolean {
	const end = source.indexOf('\n', byte);
	return source.slice(byte, end < 0 ? undefined : end).trim() === '';
}

// ── Paste as plain text at a caret ───────────────────────────────────────────

/** Whether a plain paste at `at` changed bytes only there and put `text` in as the block shows it
 *  (as written, where the block's text is literal), a blank line over the block below aside. */
export function plainPasteHolds(
	read: Read,
	at: number,
	text: string,
	got: string,
	host: CheckHost,
	mode: Mode
): boolean {
	// A line that could close the fence around literal text grows the fence, which the rows hold.
	const target = leafAt(read, at);
	if (target && host.facts(target.type).body === 'literal') {
		if (literalPrefix(read, at, target, lf(text), host) === null) return true;
	}
	if (insertedOnly(read, at, text, got, host, mode)) return true;
	const below = got.length - (read.source.length - (leafAt(read, at)?.to ?? at));
	const blank = /(?:^|\n)([ \t>]*\r?\n)$/.exec(got.slice(0, below))?.[1];
	const bare = blank ? got.slice(0, below - blank.length) + got.slice(below) : got;
	return (
		bare !== got &&
		insertedOnly(read, at, text, bare, host, mode) &&
		apartBelow(read, at, bare, host).includes(got)
	);
}

function insertedOnly(
	read: Read,
	at: number,
	text: string,
	got: string,
	host: CheckHost,
	mode: Mode
): boolean {
	const grown = got.length - read.source.length;
	if (
		grown < 0 ||
		!got.startsWith(read.source.slice(0, at)) ||
		!got.endsWith(read.source.slice(at))
	)
		return false;
	const inserted = got.slice(at, at + grown);
	const point = read.layout.pointAt(at);
	const leaf = point && read.blocks.find((b) => b.path.join() === point.path.join());
	const literal = leaf ? host.facts(leaf.type).body === 'literal' : false;
	const title = leaf?.text ? titleLine(read, at, leaf, lf(text), host) : null;
	if (title !== null) {
		const lead = title.length - oneLine(lf(text)).length;
		return (
			inserted.startsWith(' '.repeat(lead)) &&
			(literal ? inserted.slice(lead) : host.shows(inserted.slice(lead), mode)) ===
				title.slice(lead)
		);
	}
	const bare = (t: string) => t.replace(/\n$/, '');
	if (literal && leaf) {
		const prefix = literalPrefix(read, at, leaf, lf(text), host);
		const after = !nothingVisibleAfter(read.source, at);
		const lines = (t: string) => join(t.split('\n'), prefix ?? '', '\n', after);
		return [lf(text), bare(lf(text))].some((t) => lines(t) === lf(inserted));
	}
	const unprefixed = lf(inserted).replace(/\n[ \t>]*/g, '\n');
	return bare(host.shows(unprefixed, mode)) === bare(lf(text));
}
