// What the laws expect, worked out from the source bytes and the host's layout alone, never from the
// package under test: the bytes a copy writes, the bytes a paste at a caret gives, and the bytes a
// new line in a container starts with.

import type { DocumentView, NodeView } from '#lib/core/node-views.js';
import type { Mode } from '#lib/range-edit/host.js';
import type { LaidBlock, LaidLine, Layout } from '#lib/range-edit/layout.js';
import type { CheckHost } from './test-host';

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
			b.lines !== undefined &&
			(side === 'start' ? b.from <= byte && byte < b.to : b.from < byte && byte <= b.to)
	);
}

/** The containers a caret at `at` sits in: a container's last byte counts when no line ending
 *  closes it there (a document's last line). */
export function containersHolding(read: Read, at: number): LaidBlock[] {
	return read.blocks.filter(
		(b) =>
			b.lines !== undefined &&
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
			c.lines &&
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
	return container.lines!.find((l) => l.from <= byte && byte < l.to) ?? container.lines!.at(-1)!;
}

const firstBodyLine = (container: LaidBlock) => container.lines!.find((l) => !l.own);

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
		const marker = markerOn(read, line) || lazyMarker(read, container, line, facts.lines);
		if (facts.lines === 'first-line' && line === firstBodyLine(container)) {
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
 *  as the container's nearest marked line spells it. */
function lazyMarker(read: Read, container: LaidBlock, line: LaidLine, shape: string): string {
	if (shape !== 'every-line') return '';
	const lines = container.lines!.filter((l) => !l.own && l.markerTo > l.from);
	const before = lines.filter((l) => l.from < line.from).at(-1);
	const marked = before ?? lines[0];
	return marked ? markerOn(read, marked) : '';
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
		const line = container.lines!.find((l) => l.from <= row.from && row.from < l.to);
		return read.source.slice(container.from, line ? line.to : row.to);
	}
	const first = container.lines!.findIndex((l) => !l.own);
	const lines = first < 0 ? container.lines! : container.lines!.slice(0, first);
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
		const last = container.lines!.at(-1)!;
		if (!last.own || last.from < to) continue;
		const closer = read.source.slice(last.from, last.to).replace(/\r?\n$/, '');
		closing += endingOf(read.source) + closer;
	}
	return opening + withoutSharedMarkers(read, shared, from, to) + closing;
}

/** A table's header and delimiter lines when `from` sits in a row below them, each line followed by
 *  what `from`'s line holds before it inside `shared`: a copy of its rows still reads as a table. */
function tableHeadAbove(read: Read, table: LaidBlock, shared: LaidBlock | null, from: number) {
	const delimiter = table.lines!.findIndex((line) => line.own);
	if (delimiter < 0 || from < table.lines![delimiter].to) return '';
	const lineStart = read.source.lastIndexOf('\n', from - 1) + 1;
	const inside = shared ? Math.max(lineStart, lineOf(shared, lineStart).markerTo) : lineStart;
	const markers = read.source.slice(inside, from);
	return table
		.lines!.slice(0, delimiter + 1)
		.map((line) => read.source.slice(line.from, line.to) + markers)
		.join('');
}

/** Law 3's third declared exception: a range from a table's rows below its delimiter copies the
 *  header too, so the copy pasted elsewhere reads as a table; pasted back, the header doubles. */
export function startsBelowTableHead(read: Read, from: number, host: CheckHost): boolean {
	return read.blocks.some((b) => {
		if (host.facts(b.type).lines !== 'rows' || !(b.from < from && from < b.to)) return false;
		const delimiter = b.lines!.find((line) => line.own);
		return delimiter !== undefined && from >= delimiter.to;
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
		return b.type === 'fencedCode' || lines === 'fenced' || lines === 'rows';
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
	for (const line of shared.lines!) {
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
		(b.lines ?? []).filter((l) => l.own).map((l) => trimmed(source.slice(l.from, l.to)))
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
 *  either side; a leading container taken in by one the caret sits in; a leading block of its own
 *  kind splitting a paragraph; or a shape the rows hold. */
export type PasteShape = 'text' | 'blocks' | 'absorbed' | 'split' | 'other';

/** The source a paste of `text` at `at` may give, with the rule that gives it. */
export function expectedPaste(
	read: Read,
	at: number,
	text: string,
	host: CheckHost
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
	const eol = endingOf(read.source);
	const after = !nothingVisibleAfter(read.source, at);
	const lines = clip.source.split('\n');
	const variants = (write: (ls: string[]) => string) => [write(lines)];
	const splice = (prefix: string, head: string) => (ls: string[]) =>
		read.source.slice(0, at) + head + join(ls, prefix, eol, after) + read.source.slice(at);

	const target = leafAt(read, at);
	if (!target || host.facts(target.type).textPosition === 'never')
		return { shape: 'other', bytes: [] };
	const targetFacts = host.facts(target.type);
	const isTitle = read.blocks.some(
		(b) =>
			b.lines &&
			host.facts(b.type).titleRow?.type === target.type &&
			b.from <= target.from &&
			target.to <= b.to
	);
	// A title row holds one line: the paste goes in flattened to it.
	if (isTitle) {
		const flat = lf(text).replace(/\n+$/, '').replace(/\n/g, ' ');
		return { shape: 'text', bytes: [read.source.slice(0, at) + flat + read.source.slice(at)] };
	}
	// Literal text (code) takes the paste as written, whatever it would read as elsewhere.
	// Fence lines pasted into literal text make its fences grow, which the rows hold.
	if (targetFacts.body === 'literal' && /^(```|~~~)/m.test(text))
		return { shape: 'other', bytes: [] };
	if (targetFacts.body === 'literal') {
		return { shape: 'text', bytes: variants(splice(continuationAt(read, at, host), '')) };
	}
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
		const blank = splice(prefix, eol + prefix.trimEnd() + eol + prefix)(lines);
		return { shape: 'split', bytes: own ? [blank, line] : [blank] };
	}
	return { shape: 'other', bytes: [] };
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
	const keyValue = (r: Read, b: LaidBlock) =>
		key
			? (treeNodeAt(r.tree, b.path)?.metadata as Record<string, unknown> | undefined)?.[key]
			: undefined;
	let taker: LaidBlock | null = null;
	for (const c of containersHolding(read, at)) {
		if (into.includes(c.type) && keyValue(read, c) === keyValue(pasted, first)) taker = c;
	}
	return taker;
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
 *  (as written, where the block's text is literal). */
export function plainPasteHolds(
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
	const unprefixed = lf(inserted).replace(/\n[ \t>]*/g, '\n');
	const bare = (t: string) => t.replace(/\n$/, '');
	return bare(literal ? lf(inserted) : host.shows(unprefixed, mode)) === bare(lf(text));
}
