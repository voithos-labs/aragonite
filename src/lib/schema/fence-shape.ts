/**
 * A fenced block's shape read from its fences: its opener, its text range (the body between the
 * fence lines), the rule that keeps a write of its bytes legal, and what a completion must look
 * like to read back as it. An info fence follows the code fence's rules, closer growth included.
 * A fixed fence is read in one place, `readFixed`, which every one of those asks.
 */
import { devChecksOn, devWarn } from '@voithos-labs/aragonite/dev-checks';
import type { CstNode, PluginBlockKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import {
	firstDisplayLine,
	ownTrailingLineEnding,
	splitLines,
	trailingLineEnding,
	trimTrailingLineEnding,
	type ParsedLine
} from '../core/lines';
import { joinRaw } from '../core/parser';
import {
	fenceAnatomy,
	fenceReading,
	matchFenceInfo,
	type FenceOpen
} from '../core/parsers/fence-syntax';
import { scanFence } from '../core/parsers/fenced-code';
import { writtenSpan } from '../core/written-span';
import type { BlockOpener, ClosedReading, OpenContext } from './block-openers';
import type { WriteContext, WriteRule } from './block-kind-descriptor';
import { fenceRawWrite, fenceShapeOfRaw } from './fenced-code-raw';
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

	// The body runs from the end of the opening line to the start of the closing line, or to the end
	// of an unclosed fence; with no fence line to leave out, it's all of the bytes.
	const range = (raw: string): { start: number; end: number } => {
		const anatomy = opensInfo(raw) && fenceAnatomy(raw);
		if (anatomy) return { start: anatomy.bodyStart, end: anatomy.closerStart };
		const split = splitFixed(fixed, raw, false);
		return split
			? { start: split.bodyStart, end: split.closerStart }
			: { start: 0, end: raw.length };
	};

	return {
		range: (node: NodeView) => range(node.raw),
		multiLine: true,
		writes: {
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
		} satisfies WriteRule,
		/** Lines a completion wrote: an opener on the first, its closer on the last, as the parser
		 *  would read them. */
		claims(lines: readonly string[]): boolean {
			if (lines.length < 2) return false;
			if (infoOpen(lines[0])) return true;
			const read = readFixed(
				fixed,
				lines.map((text) => ({ text })),
				0,
				lines.length,
				false
			);
			return read?.closing === lines.length - 1;
		},
		opener(kind: PluginBlockKind): BlockOpener {
			const nodeOf = (ctx: OpenContext, raw: string): CstNode => ({
				kind,
				leadingTrivia: ctx.leadingTrivia,
				raw
			});
			return {
				priority,
				interruptsParagraph: (text) =>
					infoOpen(text) !== null || (interrupts && openFixed(fixed, text) !== null),
				// An info fence waits as the code fence does, so it declares that fence's own reading.
				readingNotFinal: fixed.length ? fixedReading(fixed) : fenceReading,
				tryOpen(ctx) {
					const info = infoOpen(ctx.line.text);
					if (info) {
						const scan = scanFence(ctx, info);
						return { node: nodeOf(ctx, scan.raw), consumed: scan.consumed };
					}
					const read = readFixed(fixed, ctx.lines, ctx.index, ctx.end, false);
					// Unclosed, a fixed opener is the line it is until its closer arrives.
					if (read === null || read.closing === -1) return null;
					const raw = joinRaw(ctx.lines, ctx.index, read.closing + 1);
					return { node: nodeOf(ctx, raw), consumed: read.closing + 1 - ctx.index };
				}
			};
		}
	};
}

/* -------------------------------------------------------------------------- */
/*                         The fixed fence's reading                          */
/* -------------------------------------------------------------------------- */

interface FixedFence {
	/** Its closer when it's one fixed line, which a candidate line can be compared with. */
	fixedCloser: string | null;
	matches(text: string): RegExpExecArray | null;
	closer(open: RegExpExecArray): string;
	escape?(bodyLine: string): string;
}

function fixedFence(fence: Extract<Fence, { open: RegExp }>): FixedFence {
	const pattern = new RegExp(fence.open.source, fence.open.flags.replace(/[gy]/g, ''));
	return {
		matches(text) {
			const match = pattern.exec(text);
			return match && match.index === 0 && match[0].length === text.length ? match : null;
		},
		fixedCloser: typeof fence.close === 'string' ? fence.close : null,
		closer: (open) => (typeof fence.close === 'string' ? fence.close : fence.close(open)),
		escape: fence.escape
	};
}

/** The fixed fence a line opens, and the closing line its opener names. */
function openFixed(
	fixed: readonly FixedFence[],
	text: string
): { fence: FixedFence; closer: string } | null {
	for (const fence of fixed) {
		const match = fence.matches(text);
		if (match) return { fence, closer: fence.closer(match) };
	}
	return null;
}

/** A fixed fence read off lines: the fence and closer its first line opens, and the index of the
 *  line closing it, -1 while none does. */
interface FixedRead {
	fence: FixedFence;
	closer: string;
	closing: number;
}

// The first line spelling the closer closes the fence; text a block holds (`held`) closes at the
// last one where the fence has an `escape`, since its write escapes the ones above.
function readFixed(
	fixed: readonly FixedFence[],
	lines: readonly { text: string }[],
	from: number,
	end: number,
	held: boolean
): FixedRead | null {
	const open = openFixed(fixed, lines[from].text);
	if (!open) return null;
	const last = held && open.fence.escape !== undefined;
	let closing = -1;
	for (let at = from + 1; at < end; at++) {
		if (lines[at].text !== open.closer) continue;
		closing = at;
		if (!last) break;
	}
	return { ...open, closing };
}

/** A text read whole as a fixed fence: its body from `bodyStart`, its closing line from
 *  `closerStart` to `closerEnd`, and what follows from there; an unclosed one's body runs to the end. */
interface FixedSplit extends FixedRead {
	lines: ParsedLine[];
	bodyStart: number;
	closerStart: number;
	closerEnd: number;
}

function splitFixed(fixed: readonly FixedFence[], text: string, held: boolean): FixedSplit | null {
	const lines = splitLines(text);
	const read = lines.length > 0 ? readFixed(fixed, lines, 0, lines.length, held) : null;
	if (!read) return null;
	const closing = read.closing === -1 ? null : lines[read.closing];
	return {
		...read,
		lines,
		bodyStart: lines[0].end,
		closerStart: closing?.start ?? text.length,
		closerEnd: closing ? closing.start + closing.text.length : text.length
	};
}

/** A fixed opener's text waits, read as a paragraph, until a line below it closes it. */
function fixedReading(fixed: readonly FixedFence[]): ClosedReading {
	const read = (raw: string) => splitFixed(fixed, raw, false);
	return {
		notFinal: (raw) => read(raw)?.closing === -1,
		// A closer worked out from the opener can be any line, so every line may be the one.
		mayClose: (text) => fixed.some((f) => f.fixedCloser === null || f.fixedCloser === text),
		closer: (raw) => read(raw)?.closer ?? ''
	};
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
	const display = trimTrailingLineEnding(raw);
	const split = splitFixed(fixed, display, true);
	if (!split) return { raw, offset, escaped: false };
	const tail = ownTrailingLineEnding(raw);
	const caret = Math.min(offset, display.length);
	// The closer goes in after every written byte, so no offset moves.
	const written =
		split.closing === -1
			? {
					text: display + trailingLineEnding(ctx.node.raw, ctx.lineEnding) + split.closer,
					caret,
					escaped: false
				}
			: escapedBody(split, display, caret);
	const intoTail = Math.min(Math.max(offset - display.length, 0), tail.length);
	return { raw: written.text + tail, offset: written.caret + intoTail, escaped: written.escaped };
}

/** The held text with each body line spelling the closer escaped, the caret moved by what each
 *  escape put in before it. */
function escapedBody(
	{ lines, closing, closer, fence: { escape } }: FixedSplit,
	display: string,
	caret: number
): { text: string; caret: number; escaped: boolean } {
	if (!escape) return { text: display, caret, escaped: false };
	let text = '';
	let moved = caret;
	let escaped = false;
	lines.forEach((line, index) => {
		const escapes = index > 0 && index < closing && line.text === closer;
		const out = escapes ? escape(line.text) : line.text;
		escaped ||= escapes;
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

// An escape that leaves the line closing the block passes every read, so the write says so.
function warnIfStillClosed(fixed: readonly FixedFence[], text: string, ctx: WriteContext): void {
	if (!devChecksOn) return;
	const parsed = splitFixed(fixed, text, false);
	const held = splitFixed(fixed, text, true);
	if (!parsed || !held || parsed.closerStart === held.closerStart) return;
	devWarn(
		'fence-escape',
		`block '${ctx.node.kind}': its escape leaves a body line reading as its closer ` +
			`${JSON.stringify(parsed.closer)}, so the block ends there: return a line that doesn't`
	);
}
