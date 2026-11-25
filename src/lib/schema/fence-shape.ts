/**
 * The shapes read from fence lines, each in one place. A fenced block's: its openers, its text
 * range (the body between the fence lines), the rule that keeps a write of its bytes legal, and
 * what a completion must look like to read back as it; an info fence follows the code fence's
 * rules, closer growth included, and a fixed fence is read by `readFixed`, which every one of those
 * asks. A fenced container's, from its opening and closing lines paired by depth (`fencedReading`).
 * Both share the sticky opener, the waiting reading and the line escape with its caret map.
 */
import { devChecksOn, devWarn } from '@voithos-labs/aragonite/dev-checks';
import {
	makeBlockNode,
	setPluginMetadata,
	type CstNode,
	type PluginBlockKind
} from '../core/nodes';
import type { NodeView } from '../core/node-views';
import {
	displayLength,
	displayLines,
	firstDisplayLine,
	ownTrailingLineEnding,
	splitLines,
	trailingLineEnding,
	trimTrailingLineEnding,
	withLineEnding,
	type DisplayLine,
	type LineEnding,
	type ParsedLine
} from '../core/lines';
import { joinRaw, parseContainerBody, type ContainerBodyWrap } from '../core/parser';
import {
	fenceAnatomy,
	fenceReading,
	fenceRunLength,
	findFenceCloser,
	matchFenceInfo,
	matchFenceOpen,
	type FenceOpen
} from '../core/parsers/fence-syntax';
import { scanFence } from '../core/parsers/fenced-code';
import { writtenSpan } from '../core/written-span';
import type { BlockOpener, ClosedReading, OpenContext } from './block-openers';
import type { WriteContext, WriteRule } from './block-kind-descriptor';
import { fenceRawWrite, fenceShapeOfRaw } from './fenced-code-raw';
import { titleRowKind } from './title-row-leaf';
import type { Fence } from './block-shapes';

/* -------------------------------------------------------------------------- */
/*                                 The shape                                  */
/* -------------------------------------------------------------------------- */

/** Everything a fenced block type reads off its fences. */
export function fenceShape(fences: readonly Fence[], priority: number, interrupts: boolean) {
	const infos = fences.flatMap((f) => ('info' in f ? [f.info].flat() : []));
	const infoMatchers = infos.map((info) => matchFenceInfo(info));
	const fixed = fences.flatMap((f) => ('open' in f ? [fixedFence(f)] : []));

	const infoOpen = (text: string): FenceOpen | null => {
		for (const match of infoMatchers) {
			const open = match(text);
			if (open) return open;
		}
		return null;
	};
	// An info fence is tried first, as the openers are.
	const opensInfo = (raw: string) => infoOpen(firstDisplayLine(raw).text) !== null;
	const infoRule = fenceRawWrite(fenceShapeOfRaw);

	// Where the fence lines sit: the body runs from the end of the opening line to the start of the
	// closing line, or to the end of an unclosed fence. `held` reads a fixed fence as the write holds it.
	const parts = (text: string, held: boolean): FenceParts | null => {
		const anatomy = opensInfo(text) && fenceAnatomy(text);
		if (anatomy) return { ...anatomy, closerEnd: text.length };
		return splitFixed(fixed, text, held) ?? brokenSplit(fixed, text);
	};

	// With no fence line to leave out, the body is all of the bytes.
	const range = (raw: string): { start: number; end: number } => {
		const at = parts(raw, false);
		return at ? { start: at.bodyStart, end: at.closerStart } : { start: 0, end: raw.length };
	};

	// A shown text splits as the write holds it, so a body line an `escape` will rewrite stays body.
	const split = (text: string): ShownFence | null => {
		const at = parts(text, true);
		if (!at) return null;
		const { bodyStart, closerStart, closerEnd } = at;
		return {
			opener: text.slice(0, bodyStart),
			body: text.slice(bodyStart, closerStart),
			closer: text.slice(closerStart, closerEnd),
			after: text.slice(closerEnd)
		};
	};

	// The body as a code block's reads: the line ending before the closer is the closer's, and a
	// block with no body line has none.
	const bodyOf = (text: string): { start: number; end: number } | null => {
		const { start, end } = range(text);
		return start === end ? null : { start, end: start + displayLength(text.slice(start, end)) };
	};

	const writes: WriteRule = {
		normalize(raw, ctx) {
			if (opensInfo(raw)) return infoRule.normalize(raw, ctx);
			const written = fixedWrite(fixed, raw, 0, ctx);
			if (written.escaped) warnIfStillClosed(fixed, written.raw, ctx);
			return written.raw;
		},
		mapOffset: (raw, offset, ctx) =>
			opensInfo(raw)
				? infoRule.mapOffset(raw, offset, ctx)
				: fixedWrite(fixed, raw, offset, ctx).offset,
		text: (raw) => {
			const { start, end } = range(raw);
			return raw.slice(start, end);
		}
	};

	return {
		range: (node: NodeView) => range(node.raw),
		body: (node: NodeView) => bodyOf(node.raw),
		/** A shown text's body, read as `body` reads a block's bytes. */
		bodyText(shown: string): string {
			const at = bodyOf(shown);
			return at ? shown.slice(at.start, at.end) : '';
		},
		multiLine: true,
		split,
		/** The block's bytes with `text` as its body, a fence grown past a line that would close it;
		 *  null where one still would. An emptied body takes its last line break with it. */
		writeBody(node: NodeView, text: string, ending: LineEnding): string | null {
			const raw = node.raw;
			const lines = withLineEnding(text, ending);
			const at = bodyOf(raw);
			const { start, end } = range(raw);
			let written: string;
			if (at) written = raw.slice(0, at.start) + lines + raw.slice(text === '' ? end : at.end);
			else if (text === '') written = raw;
			else {
				// The line written ends as the opener's line does, before a closer or the end.
				const head = raw.slice(0, start);
				written = head.endsWith('\n')
					? head + lines + ending + raw.slice(start)
					: head + ending + lines;
			}
			// A one-line block given lines takes them on lines of its own, as a typed break does.
			const shown = trimTrailingLineEnding(written);
			const broken = text.includes('\n') ? brokenOneLine(fixed, shown) : null;
			if (broken?.closed)
				written = onOwnLines(shown, broken, 0).text + ownTrailingLineEnding(written);
			const normalized = writes.normalize(written, { node, mode: 'literal', lineEnding: ending });
			const out = opensInfo(raw) ? keptCloser(raw, normalized) : normalized;
			const read = parts(out, false);
			return read && trimTrailingLineEnding(out.slice(read.closerEnd)) === '' ? out : null;
		},
		/** The shown text in the shape the block keeps while it's edited: a one-line block a line
		 *  break went into on lines of its own, and a closed block with no body line given one. */
		reshape(text: string, caret: number, lineEnding: LineEnding): CaretText | null {
			const broken = brokenOneLine(fixed, text);
			const ownLines = broken?.closed ? onOwnLines(text, broken, caret) : null;
			return withBodyLine(split(ownLines?.text ?? text), lineEnding) ?? ownLines;
		},
		oneLine: fixed.some((f) => f.oneLine)
			? (line: string) => openFixed(fixed, line)?.oneLine === true
			: undefined,
		writes,
		/** Lines a completion wrote: an opener on the first, its closer on the last, as the parser
		 *  would read them. */
		claims(lines: readonly string[]): boolean {
			if (lines.length === 0) return false;
			if (lines.length > 1 && infoOpen(lines[0])) return true;
			const read = readFixed(
				fixed,
				lines.map((text) => ({ text })),
				false
			);
			return read?.closing === lines.length - 1;
		},
		/** One opener per kind of fence, each with its own reading: an info fence waits as the code
		 *  fence does, so it declares that fence's reading itself. */
		openers(kind: PluginBlockKind): BlockOpener[] {
			const nodeOf = (ctx: OpenContext, raw: string): CstNode => ({
				kind,
				leadingTrivia: ctx.leadingTrivia,
				raw
			});
			const info: BlockOpener = {
				priority,
				interruptsParagraph: (text) => infoOpen(text) !== null,
				readingNotFinal: fenceReading,
				tryOpen(ctx) {
					const open = infoOpen(ctx.line.text);
					if (!open) return null;
					const scan = scanFence(ctx, open);
					return { node: nodeOf(ctx, scan.raw), consumed: scan.consumed };
				}
			};
			const own: BlockOpener = {
				priority,
				interruptsParagraph: interrupts && ((text) => openFixed(fixed, text) !== null),
				readingNotFinal: fixedReading(fixed),
				tryOpen(ctx) {
					const read = readFixed(fixed, ctx.lines, false, ctx.index, ctx.end);
					// Unclosed, a fixed opener is the line it is until its closer arrives.
					if (read === null || read.closing === -1) return null;
					const raw = joinRaw(ctx.lines, ctx.index, read.closing + 1);
					return { node: nodeOf(ctx, raw), consumed: read.closing + 1 - ctx.index };
				}
			};
			return [...(infoMatchers.length > 0 ? [info] : []), ...(fixed.length > 0 ? [own] : [])];
		}
	};
}

/** A shown text split at its fence lines, each keeping its own ending, and what follows the closer. */
interface ShownFence {
	opener: string;
	body: string;
	closer: string;
	after: string;
}

interface CaretText {
	text: string;
	caret: number;
}

// Its fence lines hide where markers do, so a closed block with no body line gains an empty one,
// ended like its opener line, and the caret goes there.
function withBodyLine(shown: ShownFence | null, lineEnding: LineEnding): CaretText | null {
	if (!shown || shown.closer === '' || shown.body !== '') return null;
	const openerLine = trimTrailingLineEnding(shown.opener);
	const ending = ownTrailingLineEnding(shown.opener) || lineEnding;
	return {
		text: openerLine + ending + ending + shown.closer + shown.after,
		caret: openerLine.length + ending.length
	};
}

// A body write grows a fence and never shortens one: a closer still as long as the grown opener
// stays as it was written.
function keptCloser(was: string, now: string): string {
	const before = fenceAnatomy(was);
	const after = fenceAnatomy(now);
	if (!before?.closed || !after?.closed || before.marker !== after.marker) return now;
	const closer = trimTrailingLineEnding(was.slice(before.closerStart));
	if (fenceRunLength(closer, before.marker) < after.length) return now;
	const end = after.closerStart + trimTrailingLineEnding(now.slice(after.closerStart)).length;
	return now.slice(0, after.closerStart) + closer + now.slice(end);
}

/* -------------------------------------------------------------------------- */
/*                         The fixed fence's reading                          */
/* -------------------------------------------------------------------------- */

interface FixedFence {
	/** Its closer when it's one fixed line, which a candidate line can be compared with. */
	fixedCloser: string | null;
	/** `open` matched at the start of a line, wherever the match ends. */
	openAt(text: string): RegExpExecArray | null;
	closer(open: RegExpExecArray): string;
	oneLine: boolean;
	escape?(bodyLine: string): string;
}

function fixedFence(fence: Extract<Fence, { open: RegExp }>): FixedFence {
	if (fence.oneLine && endsInAnchor(fence.open.source)) {
		throw new Error(
			`fencedBlock: a oneLine fence's open ${fence.open} ends in a $ anchor, so it can't match ` +
				'the start of a one-line block: drop the $'
		);
	}
	return {
		openAt: matchAtStart(fence.open),
		fixedCloser: typeof fence.close === 'string' ? fence.close : null,
		closer: (open) => (typeof fence.close === 'string' ? fence.close : fence.close(open)),
		oneLine: fence.oneLine ?? false,
		escape: fence.escape
	};
}

// A `$` last in the source, unless an odd run of backslashes escapes it.
function endsInAnchor(source: string): boolean {
	let slashes = 0;
	for (let at = source.length - 2; at >= 0 && source[at] === '\\'; at--) slashes++;
	return source.endsWith('$') && slashes % 2 === 0;
}

/** How a line opens a fixed fence: the fence, the closer its opener names, where the opener's match
 *  ends (`openEnd`), and whether the line is the whole block, closer and all. */
interface FixedOpen {
	fence: FixedFence;
	closer: string;
	openEnd: number;
	oneLine: boolean;
}

// The one-line form is tried first: its closer ends the line, at or past the opener's end.
function openFixed(fixed: readonly FixedFence[], text: string): FixedOpen | null {
	for (const fence of fixed) {
		const match = fence.openAt(text);
		if (!match) continue;
		const closer = fence.closer(match);
		const openEnd = match[0].length;
		const oneLine =
			fence.oneLine &&
			closer !== '' &&
			text.length - closer.length >= openEnd &&
			text.endsWith(closer);
		if (oneLine || openEnd === text.length) return { fence, closer, openEnd, oneLine };
	}
	return null;
}

/** A fixed fence read off lines: how its first line opens it, and the index of the line closing
 *  it, -1 while none does. */
interface FixedRead extends FixedOpen {
	closing: number;
}

function readFixed(
	fixed: readonly FixedFence[],
	lines: readonly { text: string }[],
	held: boolean,
	from = 0,
	end = lines.length
): FixedRead | null {
	const open = openFixed(fixed, lines[from].text);
	return open && { ...open, closing: closingLine(open, lines, held, from, end) };
}

// A one-line block closes on its own line, else the first line below spelling the closer; held text
// closes at the last such line where the fence has an `escape`, as its write escapes the rest.
function closingLine(
	open: FixedOpen,
	lines: readonly { text: string }[],
	held: boolean,
	from: number,
	end: number
): number {
	if (open.oneLine) return from;
	const last = held && open.fence.escape !== undefined;
	let closing = -1;
	for (let at = from + 1; at < end; at++) {
		if (lines[at].text !== open.closer) continue;
		closing = at;
		if (!last) break;
	}
	return closing;
}

/** A fenced text's body from `bodyStart`, its closer from `closerStart` to `closerEnd`, and what
 *  follows from there; an unclosed one's body runs to the end. */
interface FenceParts {
	bodyStart: number;
	closerStart: number;
	closerEnd: number;
}

/** A text read whole as a fixed fence. */
interface FixedSplit extends FixedRead, FenceParts {
	lines: ParsedLine[];
	bodyStart: number;
	closerStart: number;
	closerEnd: number;
}

// The shown text is split by its reshape, its paint and its write in a row, so the last split is kept.
let lastSplit: {
	fixed: readonly FixedFence[];
	text: string;
	held: boolean;
	split: FixedSplit | null;
} | null = null;

function splitFixed(fixed: readonly FixedFence[], text: string, held: boolean): FixedSplit | null {
	const last = lastSplit;
	if (last && last.fixed === fixed && last.held === held && last.text === text) return last.split;
	const split = splitWhole(fixed, text, held);
	lastSplit = { fixed, text, held, split };
	return split;
}

function splitWhole(fixed: readonly FixedFence[], text: string, held: boolean): FixedSplit | null {
	// Line 0 first, so a block no fixed fence opens is never split whole.
	const open = openFixed(fixed, firstDisplayLine(text).text);
	const lines = open ? splitLines(text) : [];
	if (!open || lines.length === 0) return null;
	const closing = closingLine(open, lines, held, 0, lines.length);
	if (open.oneLine) {
		const closerEnd = lines[0].text.length;
		const closerStart = closerEnd - open.closer.length;
		return { ...open, closing, lines, bodyStart: open.openEnd, closerStart, closerEnd };
	}
	const closer = closing === -1 ? null : lines[closing];
	return {
		...open,
		closing,
		lines,
		bodyStart: lines[0].end,
		closerStart: closer?.start ?? text.length,
		closerEnd: closer ? closer.start + closer.text.length : text.length
	};
}

/** A fixed opener's text waits, read as a paragraph, until a line below it closes it. */
function fixedReading(fixed: readonly FixedFence[]): ClosedReading {
	return waitingReading(
		(raw) => splitFixed(fixed, raw, false),
		// A closer worked out from the opener can be any line, so every line may be the one.
		(text) => fixed.some((f) => f.fixedCloser === null || f.fixedCloser === text)
	);
}

/* -------------------------------------------------------------------------- */
/*                      What both fence readings share                        */
/* -------------------------------------------------------------------------- */

/** `pattern` matched at the start of a line, wherever the match ends. */
function matchAtStart(pattern: RegExp): (text: string) => RegExpExecArray | null {
	// Sticky, so a line is matched at its start and the rest of it is never scanned.
	const sticky = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '') + 'y');
	return (text) => {
		sticky.lastIndex = 0;
		return sticky.exec(text);
	};
}

// An escape that leaves a body line ending the block passes every read, so the write says so.
function warnEscapeLeft(ctx: WriteContext, line: string): void {
	devWarn(
		'fence-escape',
		`block '${ctx.node.kind}': its escape leaves a body line ${line}, so the block ends there: ` +
			`return a line that doesn't`
	);
}

/** An opener's bytes wait while the reading `read` gives them finds no closing line. */
function waitingReading(
	read: (raw: string) => { closing: number; closer: string } | null,
	mayClose: (text: string) => boolean
): ClosedReading {
	return {
		notFinal: (raw) => read(raw)?.closing === -1,
		mayClose,
		closer: (raw) => read(raw)?.closer ?? ''
	};
}

/** The text with each line `escapes` names passed through `escape`, the caret moved by what each
 *  escape put in before it. */
function escapeLines(
	lines: readonly ParsedLine[],
	escapes: (index: number) => boolean,
	escape: (line: string) => string,
	caret: number
): { text: string; caret: number; escaped: boolean } {
	let text = '';
	let moved = caret;
	let escaped = false;
	lines.forEach((line, index) => {
		const escapesLine = escapes(index);
		const out = escapesLine ? escape(line.text) : line.text;
		escaped ||= escapesLine;
		if (caret > line.start && out !== line.text) {
			const span = writtenSpan(line.text, out);
			const at = caret - line.start;
			if (at >= span.removedEnd) moved += out.length - line.text.length;
			else if (at > span.start) moved += span.end - at;
		}
		text += out + line.lineEnding;
	});
	return { text, caret: moved, escaped };
}

/* -------------------------------------------------------------------------- */
/*                          The fixed fence's write                           */
/* -------------------------------------------------------------------------- */

/** A cut closer comes back on a line of its own, ended like the block, and a body line spelling the
 *  closer goes through `escape`; a write whose first line opens no fixed fence is left alone. */
function fixedWrite(
	fixed: readonly FixedFence[],
	raw: string,
	offset: number,
	ctx: WriteContext
): { raw: string; offset: number; escaped: boolean } {
	const trimmed = trimTrailingLineEnding(raw);
	const mended = mendOneLine(fixed, trimmed, Math.min(offset, trimmed.length), ctx.mode);
	const display = mended?.text ?? trimmed;
	const split = splitFixed(fixed, display, true);
	if (!split) return { raw, offset, escaped: false };
	const tail = ownTrailingLineEnding(raw);
	const caret = mended?.caret ?? Math.min(offset, display.length);
	const intoTail = Math.min(Math.max(offset - trimmed.length, 0), tail.length);
	if (split.closing === -1) {
		// The closer goes in after every written byte, so no offset moves.
		const closer = trailingLineEnding(ctx.node.raw, ctx.lineEnding) + split.closer;
		return { raw: display + closer + tail, offset: caret + intoTail, escaped: false };
	}
	const written = escapedBody(split, display, caret);
	return { raw: written.text + tail, offset: written.caret + intoTail, escaped: written.escaped };
}

/** A text whose first line starts with a `oneLine` fence's opener but reads as neither form, as a
 *  write that broke a one-line block leaves it; `closed` when the text still ends with the closer. */
interface BrokenOneLine {
	first: DisplayLine;
	openEnd: number;
	closer: string;
	closed: boolean;
	/** Line 0 is the opener alone, as a line break right after the opener leaves it. */
	openerLine: boolean;
}

function brokenOneLine(fixed: readonly FixedFence[], text: string): BrokenOneLine | null {
	const first = firstDisplayLine(text);
	const open = openFixed(fixed, first.text);
	// A line spelling the opener alone is the fence-line form, unless nothing below closes it and
	// the text still ends with the one-line form's closer.
	const openerLine = open !== null && !open.oneLine && open.fence.oneLine;
	if (open && !openerLine) return null;
	for (const fence of fixed) {
		const match = fence.oneLine ? fence.openAt(first.text) : null;
		if (!match) continue;
		const closer = fence.closer(match);
		const openEnd = match[0].length;
		const closed = text.length - closer.length >= openEnd && text.endsWith(closer);
		if (openerLine && (!closed || splitFixed(fixed, text, false)?.closing !== -1)) return null;
		return { first, openEnd, closer, closed, openerLine };
	}
	return null;
}

/** A broken one-line block read as the write will shape it: its opener, the text after it, and
 *  the closer where the text still ends with one. */
function brokenSplit(fixed: readonly FixedFence[], text: string): FenceParts | null {
	const broken = brokenOneLine(fixed, text);
	if (!broken) return null;
	const closerStart = broken.closed ? text.length - broken.closer.length : text.length;
	return { bodyStart: broken.openEnd, closerStart, closerEnd: text.length };
}

/** A broken one-line block made to read: a cut closer comes back, a typed line break splits it
 *  onto its own lines, and pasted lines close a line 0 with text unless the last is the closer. */
function mendOneLine(
	fixed: readonly FixedFence[],
	text: string,
	caret: number,
	mode: WriteContext['mode']
): CaretText | null {
	const broken = brokenOneLine(fixed, text);
	if (!broken) return null;
	const { first, closer } = broken;
	if (first.ending === '') return { text: text + closer, caret };
	const lastLine = text.slice(text.lastIndexOf('\n') + 1);
	if (mode === 'literal' && !broken.openerLine && lastLine !== closer) {
		const lineEnd = first.text.length;
		return {
			text: text.slice(0, lineEnd) + closer + text.slice(lineEnd),
			caret: caret > lineEnd ? caret + closer.length : caret
		};
	}
	return onOwnLines(text, broken, caret);
}

// Each line takes the first line's ending, and the caret moves past each ending put in before it.
function onOwnLines(
	text: string,
	{ first, openEnd, closer, closed }: BrokenOneLine,
	caret: number
): CaretText {
	const body = text.slice(openEnd, closed ? text.length - closer.length : text.length);
	const bodyEnd = openEnd + body.length;
	const { ending } = first;
	const shift = caret < openEnd ? 0 : caret <= bodyEnd ? ending.length : 2 * ending.length;
	return { text: text.slice(0, openEnd) + ending + body + ending + closer, caret: caret + shift };
}

/** The held text with each body line spelling the closer escaped. */
function escapedBody(
	{ lines, closing, closer, fence: { escape } }: FixedSplit,
	display: string,
	caret: number
): { text: string; caret: number; escaped: boolean } {
	if (!escape) return { text: display, caret, escaped: false };
	const spellsCloser = (index: number) =>
		index > 0 && index < closing && lines[index].text === closer;
	return escapeLines(lines, spellsCloser, escape, caret);
}

function warnIfStillClosed(fixed: readonly FixedFence[], text: string, ctx: WriteContext): void {
	if (!devChecksOn) return;
	const parsed = splitFixed(fixed, text, false);
	const held = splitFixed(fixed, text, true);
	if (!parsed || !held || parsed.closerStart === held.closerStart) return;
	warnEscapeLeft(ctx, `reading as its closer ${JSON.stringify(parsed.closer)}`);
}

/* -------------------------------------------------------------------------- */
/*                       The fenced container's reading                       */
/* -------------------------------------------------------------------------- */

/** A container's own lines around its body, as `fencedLines` takes them. */
export interface FencedSpec<D extends object> {
	open: RegExp;
	data(match: RegExpExecArray): D;
	write(data: D): string;
	title?: FencedTitle;
	close: { match: RegExp; write(data: D): string };
	escape(line: string): string;
}

/** The line under the opening one that holds the title row, with the row's name and class. */
export interface FencedTitle {
	match: RegExp;
	write(title: string): string;
	/** What a screen reader and the block menu call the row; default "Title". */
	label?: string;
	/** The class on the row's text element; default `title-row`. */
	className?: string;
}

/** What the editor reads off a fenced container's lines. */
export interface FencedReading<D extends object> {
	/** The title line, where the lines have one. */
	readonly title: FencedTitle | null;
	opener(kind: PluginBlockKind, priority: number, interrupts: boolean): BlockOpener;
	/** Lines a completion wrote: the opening line first, the line closing it last. */
	claims(lines: readonly string[]): boolean;
	/** A write into the body, with each line that pairs with nothing, as `write` spells a section or
	 *  as `open` and `close.match` read one, passed through `escape`. */
	readonly bodyWrite: WriteRule;
	/** The closing line written for `data`. */
	closer(data: D): string;
	/** Where the title starts on `line`, which reads as the title line; null on any other line. */
	titleColumn(line: string): number | null;
}

// The body sits between the shape's own lines, each taking the blank line beside it.
const FENCED_BODY: ContainerBodyWrap = { afterOpenerLine: true, beforeCloserLine: true };

export function fencedReading<D extends object>(spec: FencedSpec<D>): FencedReading<D> {
	const openAt = matchAtStart(spec.open);
	const closeAt = matchAtStart(spec.close.match);
	const titleOf = spec.title ? titleReader(spec.title.match) : null;
	const escape = spec.escape ?? ((line: string) => line);

	const opening = (text: string): D | null => {
		const match = openAt(text);
		const data = match && spec.data(match);
		return data && spec.write(data) === text ? data : null;
	};
	// Only `write`'s spellings open and close a section; a body write also pairs every line
	// `open` and `close.match` read, as a browser does, and escapes what pairs with nothing.
	const written: Pairing = {
		opens: (text) => {
			const data = opening(text);
			return data && spec.close.write(data);
		},
		closes: (text, closer) => text === closer
	};
	const matched: Pairing = {
		opens: (text) => (openAt(text) ? '' : null),
		closes: (text) => closeAt(text) !== null
	};

	/** How lines read from `from`: the data, the title, where the body starts and the line closing it
	 *  (-1 while none does, or while the title line is still to come). */
	const readLines = (lines: readonly { text: string }[], from = 0, end = lines.length) => {
		const data = opening(lines[from].text);
		if (!data) return null;
		const closer = spec.close.write(data);
		const read = (title: string, body: number, closing: number) =>
			({ data, title, body, closing, closer }) as const;
		const closingFrom = (body: number) => pairedClosing(lines, body, end, closer, written);
		if (!titleOf) return read('', from + 1, closingFrom(from + 1));
		const row = lines[from + 1];
		// The title line is still to come while the opening line stands alone.
		if (row === undefined || (row.text === '' && from + 2 === end)) return read('', from + 1, -1);
		const title = titleOf(row.text);
		if (title === null) return null;
		return read(title.text, from + 2, closingFrom(from + 2));
	};
	const readRaw = (raw: string) => readLines(displayLines(raw));

	// A body line stands under the section `ctx` writes into, so its closer closes that section.
	const strays = (lines: readonly { text: string }[], ctx: WriteContext) =>
		strayLines(lines, spec.close.write((ctx.node.metadata ?? {}) as D), [written, matched]);
	const escapeStrays = (raw: string, caret: number, ctx: WriteContext) => {
		const lines = splitLines(raw);
		const stray = strays(lines, ctx);
		return escapeLines(lines, (index) => stray.has(index), escape, caret);
	};

	return {
		title: spec.title ?? null,
		opener: (kind, priority, interrupts) => ({
			priority,
			interruptsParagraph: interrupts && ((text) => opening(text) !== null),
			readingNotFinal: waitingReading(readRaw, (text) => closeAt(text) !== null),
			tryOpen(ctx) {
				const read = readLines(ctx.lines, ctx.index, ctx.end);
				if (read === null || read.closing === -1) return null;
				const body = parseContainerBody(joinRaw(ctx.lines, read.body, read.closing), FENCED_BODY, {
					scope: 'fragment',
					depth: ctx.depth + 1,
					grammar: ctx.grammar
				});
				const row = titleOf
					? [titleRow(kind, read.title, ctx.lines[read.body - 1].lineEnding)]
					: [];
				const node = makeBlockNode({
					kind,
					leadingTrivia: ctx.leadingTrivia,
					raw: joinRaw(ctx.lines, ctx.index, read.closing + 1),
					innerPrefix: body.prefix,
					children: [...row, ...body.children],
					innerSuffix: body.suffix
				});
				setPluginMetadata(node, read.data);
				return { node, consumed: read.closing + 1 - ctx.index };
			}
		}),
		claims(lines) {
			if (lines.length === 0) return false;
			const read = readLines(lines.map((text) => ({ text })));
			return read?.closing === lines.length - 1;
		},
		bodyWrite: {
			normalize(raw, ctx) {
				const out = escapeStrays(raw, 0, ctx);
				if (devChecksOn && out.escaped && strays(splitLines(out.text), ctx).size > 0) {
					warnEscapeLeft(ctx, 'that opens or closes it');
				}
				return out.text;
			},
			mapOffset: (raw, offset, ctx) => escapeStrays(raw, offset, ctx).caret
		},
		closer: (data) => spec.close.write(data),
		titleColumn: (line) => titleOf?.(line)?.start ?? null
	};
}

/** How body lines pair: a line closes the innermost open section, which waits on `closer`, or else
 *  opens one, which then waits on the closer `opens` returns; a bare fence that does both closes. */
interface Pairing {
	opens(text: string): string | null;
	closes(text: string, closer: string): boolean;
}

/** The title a line holds and where it starts, read whole by `match`, its `text` group the title;
 *  null for a line that isn't the title line. */
function titleReader(match: RegExp): (line: string) => { text: string; start: number } | null {
	if (!/\(\?<text>/.test(match.source)) {
		throw new Error(`fencedLines: title.match ${match} needs a \`text\` group, the title it reads`);
	}
	// `d` for the group's indices; `g` and `y` would carry a position between calls.
	const pattern = new RegExp(match.source, match.flags.replace(/[gyd]/g, '') + 'd');
	return (line) => {
		const read = pattern.exec(line);
		if (read?.index !== 0 || read[0].length !== line.length) return null;
		const at = read.indices?.groups?.text;
		return at ? { text: line.slice(at[0], at[1]), start: at[0] } : { text: '', start: line.length };
	};
}

/** The title row of a `container` holding `title`: one line, ended as its title line is, so its
 *  text is that line's bytes. */
const titleRow = (container: PluginBlockKind, title: string, ending: string): CstNode =>
	makeBlockNode({
		kind: titleRowKind(container),
		leadingTrivia: '',
		raw: title + (ending || '\n')
	});

/** Each line of `[from, end)` in order, until `visit` returns true; a code fence's lines are
 *  skipped whole, since a closing line inside one is code. */
function visitShapeLines(
	lines: readonly { text: string }[],
	from: number,
	end: number,
	visit: (index: number, text: string) => boolean | void
): void {
	for (let i = from; i < end; i++) {
		const fence = matchFenceOpen(lines[i].text);
		if (fence) {
			const closer = findFenceCloser(lines, i + 1, end, fence);
			i = closer === -1 ? end : closer;
			continue;
		}
		if (visit(i, lines[i].text)) return;
	}
}

/** The line closing a section whose body starts at `from` and which waits on `closer`, or -1; a
 *  nested section's closing line doesn't end the outer one. */
function pairedClosing(
	lines: readonly { text: string }[],
	from: number,
	end: number,
	closer: string,
	pairing: Pairing
): number {
	const waiting = [closer];
	let closing = -1;
	visitShapeLines(lines, from, end, (i, text) => {
		if (pairing.closes(text, waiting.at(-1)!)) waiting.pop();
		else {
			const opens = pairing.opens(text);
			if (opens !== null) waiting.push(opens);
		}
		if (waiting.length === 0) closing = i;
		return closing !== -1;
	});
	return closing;
}

/** The lines under a section waiting on `closer` that pair with nothing by any of `pairings`, each
 *  read again without those found, until every pairing agrees on what is left. */
function strayLines(
	lines: readonly { text: string }[],
	closer: string,
	pairings: readonly Pairing[]
): Set<number> {
	const stray = new Set<number>();
	for (;;) {
		const found = pairings.flatMap((pairing) => unpairedLines(lines, closer, pairing, stray));
		if (found.length === 0) return stray;
		for (const i of found) stray.add(i);
	}
}

/** The lines `pairing` leaves unpaired, `skip` read as text: a line closing the outer section, and
 *  each opening line nothing closes. */
function unpairedLines(
	lines: readonly { text: string }[],
	closer: string,
	pairing: Pairing,
	skip: ReadonlySet<number>
): number[] {
	const open: [number, string][] = [];
	const stray: number[] = [];
	visitShapeLines(lines, 0, lines.length, (i, text) => {
		if (skip.has(i)) return;
		if (pairing.closes(text, open.at(-1)?.[1] ?? closer)) {
			if (!open.pop()) stray.push(i);
			return;
		}
		const opens = pairing.opens(text);
		if (opens !== null) open.push([i, opens]);
	});
	return [...stray, ...open.map(([i]) => i)];
}
