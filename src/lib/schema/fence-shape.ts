/**
 * A fenced block's shape read from its fences: its opener, its text range (the body between the
 * fence lines), the rule that keeps a write of its bytes legal, and what a completion must look
 * like to read back as it. An info fence follows the code fence's rules, closer growth included.
 */
import type { CstNode, PluginBlockKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { displayLines, joinDisplayLines, splitLines } from '../core/lines';
import { joinRaw } from '../core/parser';
import {
	fenceAnatomy,
	fenceReading,
	matchFenceInfo,
	type FenceOpen
} from '../core/parsers/fence-syntax';
import { scanFence } from '../core/parsers/fenced-code';
import type { BlockOpener, OpenContext, UnfinishedReading } from './block-openers';
import type { WriteRule } from './block-kind-descriptor';
import { fenceRawWrite, fenceShapeOfRaw } from './fenced-code-raw';
import type { Fence } from './block-shapes';

interface FixedFence {
	/** Its closer when it's one fixed line, which a candidate line can be compared with. */
	fixedCloser: string | null;
	matches(text: string): RegExpExecArray | null;
	closer(open: RegExpExecArray): string;
	escape?(bodyLine: string): string;
}

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
	const fixedOpen = (text: string) => {
		for (const fence of fixed) {
			const match = fence.matches(text);
			if (match) return { fence, closer: fence.closer(match) };
		}
		return null;
	};
	const infoRule = fenceRawWrite(fenceShapeOfRaw);

	return {
		range: (node: NodeView) => bodyRange(node.raw),
		multiLine: true,
		writes: writeRule(infoRule, infoOpen, fixedOpen),
		/** Lines a completion wrote: an opener on the first, its closer on the last, as the parser
		 *  would read them. */
		claims(lines: readonly string[]): boolean {
			if (lines.length < 2) return false;
			if (infoOpen(lines[0])) return true;
			const open = fixedOpen(lines[0]);
			return !!open && lines.indexOf(open.closer, 1) === lines.length - 1;
		},
		opener(kind: PluginBlockKind): BlockOpener {
			return {
				priority,
				interruptsParagraph: (text) =>
					infoOpen(text) !== null || (interrupts && fixedOpen(text) !== null),
				// An info fence waits as the code fence does, so it declares that fence's own reading.
				readingNotFinal: fixed.length ? fixedReading(fixedOpen, fixed) : fenceReading,
				tryOpen(ctx) {
					const info = infoOpen(ctx.line.text);
					if (info) {
						const scan = scanFence(ctx, info);
						return { node: nodeOf(kind, ctx, scan.raw), consumed: scan.consumed };
					}
					const open = fixedOpen(ctx.line.text);
					if (!open) return null;
					for (let at = ctx.index + 1; at < ctx.end; at++) {
						if (ctx.lines[at].text !== open.closer) continue;
						const raw = joinRaw(ctx.lines, ctx.index, at + 1);
						return { node: nodeOf(kind, ctx, raw), consumed: at + 1 - ctx.index };
					}
					// Unclosed, a fixed opener is the line it is until its closer arrives.
					return null;
				}
			};
		}
	};
}

// ── Internal ─────────────────────────────────────────────────────────────────

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

const nodeOf = (kind: PluginBlockKind, ctx: OpenContext, raw: string): CstNode => ({
	kind,
	leadingTrivia: ctx.leadingTrivia,
	raw
});

// The body runs from the end of the opening line to the start of the closing line; an unclosed
// info fence's body runs to the end.
function bodyRange(raw: string): { start: number; end: number } {
	const lines = splitLines(raw);
	if (lines.length < 2) return { start: raw.length, end: raw.length };
	const start = lines[0].raw.length;
	const anatomy = fenceAnatomy(raw);
	if (anatomy) return { start: anatomy.bodyStart, end: anatomy.closerStart };
	const closing = lines[lines.length - 1].raw.length;
	return { start, end: Math.max(start, raw.length - closing) };
}

/** A fixed opener's text waits, read as a paragraph, until a line below it closes it. */
function fixedReading(
	fixedOpen: (text: string) => { fence: FixedFence; closer: string } | null,
	fixed: readonly FixedFence[]
): UnfinishedReading {
	return {
		notFinal(raw) {
			const [first, ...rest] = displayLines(raw);
			const open = first && fixedOpen(first.text);
			return !!open && !rest.some((line) => line.text === open.closer);
		},
		// A closer worked out from the opener can be any line, so every line may be the one.
		mayClose: (text) => fixed.some((f) => f.fixedCloser === null || f.fixedCloser === text),
		closer: (raw) => fixedOpen(displayLines(raw)[0]?.text ?? '')?.closer ?? ''
	};
}

/** A write's rule: an info fence grows its closer past a body line that would close it, a fixed
 *  fence escapes such a line where it can. */
function writeRule(
	infoRule: WriteRule,
	infoOpen: (text: string) => FenceOpen | null,
	fixedOpen: (text: string) => { fence: FixedFence; closer: string } | null
): WriteRule {
	const escaped = (raw: string, offset: number): { raw: string; offset: number } => {
		const lines = displayLines(raw);
		const open = lines.length > 2 ? fixedOpen(lines[0].text) : null;
		const escape = open?.fence.escape;
		if (!open || !escape) return { raw, offset };
		// The last line spelling the closer is the closer; one above it would end the block early.
		const closing = lines.map((line) => line.text).lastIndexOf(open.closer);
		let at = 0;
		let moved = offset;
		const out = lines.map((line, index) => {
			const body = index > 0 && index < closing && line.text === open.closer;
			const text = body ? escape(line.text) : line.text;
			if (at + line.text.length < offset) moved += text.length - line.text.length;
			at += line.text.length + line.ending.length;
			return { text, ending: line.ending };
		});
		return { raw: joinDisplayLines(out), offset: moved };
	};
	const isInfo = (raw: string) => infoOpen(displayLines(raw)[0]?.text ?? '') !== null;
	return {
		normalize: (raw, ctx) => (isInfo(raw) ? infoRule.normalize(raw, ctx) : escaped(raw, 0).raw),
		mapOffset: (raw, offset, ctx) =>
			isInfo(raw) ? infoRule.mapOffset(raw, offset, ctx) : escaped(raw, offset).offset,
		text: (raw) => {
			const { start, end } = bodyRange(raw);
			return raw.slice(start, end);
		}
	};
}
