/**
 * Math registered through the process-wide registrars, for the suites that hold how the editor
 * treats a kind registered that way: `$…$` as an inline widget, `$$…$$` as a block with its own
 * hand-written write rule, and ```` ```math ```` as a second block kind. The latex package itself
 * is a plugin value, and its own rows are under `test/plugins/latex/`.
 */
import {
	createScanIndex,
	declarePluginInlineKind,
	declarePluginKind,
	definePlugin,
	displayLines,
	fenceRawWrite,
	fenceReading,
	fenceShapeOfRaw,
	firstLineEnding,
	isUnicodeWhitespace,
	matchFenceInfo,
	OPENER_PRIORITIES,
	ownTrailingLineEnding,
	registerBlockCompleter,
	registerBlockKind,
	registerInlineSyntax,
	registerInlineWidgetKind,
	scanFence,
	trailingLineEnding,
	trimTrailingLineEnding,
	trimWhitespace,
	type BlockView,
	type CstNode,
	type EditorPlugin,
	type InlineNode,
	type LineEnding,
	type NodeView,
	type PluginInlineKind,
	type WriteContext,
	type WriteRule
} from '#lib/plugin.js';
import { displayLength } from '#lib/core/lines.js';
import { fenceAnatomy } from '#lib/core/parsers/fence-syntax.js';
import { testView } from './test-view';

export const MATH_INLINE = 'math';
export const MATH_BLOCK = 'mathBlock';
export const MATH_FENCE = 'mathFence';

/** Installs all three kinds, once per process, as `installPlugins` installs any `setup` plugin. */
export function registeredMath(view: BlockView = testView()): EditorPlugin {
	return definePlugin({
		// The package's name, so an editor whose list names latex reads these kinds.
		name: 'latex',
		setup() {
			registerMathInline();
			registerMathBlock(view);
		}
	});
}

/* ---- Inline math ---- */

const nextDollarFrom = createScanIndex((raw: string) => {
	const positions: number[] = [];
	for (let i = 1; i < raw.length; i++) if (raw[i] === '$') positions.push(i);
	return Int32Array.from(positions);
});

const isFlankingSpace = (ch: string | undefined) => ch !== undefined && isUnicodeWhitespace(ch);

// Pandoc's rule: a match ends at the next `$`, a closer with a space before it or a digit after
// leaves the opener literal, and a span that is only a number stays prose.
function recognizeMath(raw: string, pos: number, end: number, kind: PluginInlineKind) {
	const afterOpen = pos + 1;
	if (afterOpen >= end || isFlankingSpace(raw[afterOpen]) || raw[afterOpen] === '$') return null;
	const close = nextDollarFrom(raw, pos + 2);
	if (close === -1 || close >= end) return null;
	if (isFlankingSpace(raw[close - 1]) || /\d/.test(raw[close + 1] ?? '')) return null;
	if (/^\d[\d.,]*$/.test(raw.slice(afterOpen, close))) return null;
	return { kind, start: pos, end: close + 1 } satisfies InlineNode;
}

export function registerMathInline(): void {
	const kind = declarePluginInlineKind(MATH_INLINE);
	registerInlineSyntax('$', (raw, pos, end) => recognizeMath(raw, pos, end, kind), {
		autoPair: true
	});
	registerInlineWidgetKind(kind, {
		isWidget: () => true,
		view: (target, { source }: { source: string }) => {
			target.textContent = source.slice(1, -1);
			return {};
		},
		editing: {
			revealSource: true,
			revealContentSpan: (source) =>
				source.length >= 2 ? { start: 1, end: source.length - 1 } : null
		}
	});
}

/* ---- Block math ---- */

const FENCE = '$$';
const isFenceLine = (text: string) => text === FENCE;
const isOneLine = (text: string) =>
	text.length >= 4 && text.startsWith(FENCE) && text.endsWith(FENCE);
const opensBlock = (text: string) => isOneLine(text) || isFenceLine(text);
const blockLines = (body: string) => [FENCE, body, FENCE];

function closerLine(lines: readonly { text: string }[], from: number, end: number): number {
	const opener = lines[from].text;
	if (isOneLine(opener)) return from;
	if (!isFenceLine(opener)) return -1;
	for (let i = from + 1; i < end; i++) if (isFenceLine(lines[i].text)) return i;
	return -1;
}

export function registerMathBlock(view: BlockView): void {
	const kind = declarePluginKind(MATH_BLOCK);
	registerBlockKind(kind, {
		view,
		opener: {
			priority: OPENER_PRIORITIES.fencedCode + 5,
			interruptsParagraph: opensBlock,
			readingNotFinal: {
				notFinal: (raw) => {
					if (!raw.startsWith(FENCE)) return false;
					const lines = displayLines(raw);
					return isFenceLine(lines[0].text) && closerLine(lines, 0, lines.length) === -1;
				},
				mayClose: isFenceLine,
				closer: () => FENCE
			},
			tryOpen(ctx) {
				const closer = closerLine(ctx.lines, ctx.index, ctx.end);
				if (closer === -1) return null;
				const raw = ctx.lines
					.slice(ctx.index, closer + 1)
					.map((line) => line.raw)
					.join('');
				const node: CstNode = { kind, leadingTrivia: ctx.leadingTrivia, raw };
				return { node, consumed: closer + 1 - ctx.index };
			}
		},
		label: 'Math block',
		dragLabel: 'Equation',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		textPosition: 'while-source-shows',
		gapEdges: 'both',
		samples: [`${blockLines('x^2').join('\n')}\n`],
		bodyRange: mathBodyRange,
		rawWrite: blockWrite
	});
	registerBlockCompleter(kind, {
		onType: true,
		tryComplete: (line) =>
			isFenceLine(trimWhitespace(line))
				? { lines: blockLines(''), caret: { path: [], line: 1, column: 0 } }
				: null
	});
	registerMathFence(view);
}

const matchMathFence = matchFenceInfo('math');

export function registerMathFence(view: BlockView): void {
	const kind = declarePluginKind(MATH_FENCE);
	registerBlockKind(kind, {
		view,
		opener: {
			priority: OPENER_PRIORITIES.fencedCode - 4,
			interruptsParagraph: (line) => matchMathFence(line) !== null,
			readingNotFinal: fenceReading,
			tryOpen(ctx) {
				const fence = matchMathFence(ctx.line.text);
				if (!fence) return null;
				const scan = scanFence(ctx, fence);
				// Unclosed, it backs out to a plain `math` code block.
				if (scan.closer === -1) return null;
				const node: CstNode = { kind, leadingTrivia: ctx.leadingTrivia, raw: scan.raw };
				return { node, consumed: scan.consumed };
			}
		},
		label: 'Math block',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		textPosition: 'while-source-shows',
		gapEdges: 'both',
		bodyRange: mathBodyRange,
		samples: ['```math\nx^2\n```\n'],
		rawWrite: fenceRawWrite(fenceShapeOfRaw)
	});
}

/* ---- The `$$` reading and write ---- */

interface Split {
	opener: string;
	body: string;
	closer: string;
	after: string;
}

interface Edit {
	text: string;
	caret: number;
}

// Line 0 decides: a one-line block, or a fence line a later one closes; else a text ending `$$`
// is a one-line form holding a line break, and one that doesn't is open.
function readSource(text: string): Split | null {
	if (!text.startsWith(FENCE)) return null;
	const lines = displayLines(text);
	const closer = closerLine(lines, 0, lines.length);
	if (closer === 0) return cut(text, FENCE.length, lines[0].text.length - FENCE.length);
	const bodyStart = isFenceLine(lines[0].text)
		? lines[0].text.length + lines[0].ending.length
		: FENCE.length;
	if (closer > 0) {
		let at = 0;
		for (let i = 0; i < closer; i++) at += lines[i].text.length + lines[i].ending.length;
		return cut(text, bodyStart, at);
	}
	if (text.length >= 4 && text.endsWith(FENCE)) {
		return cut(text, FENCE.length, text.length - FENCE.length);
	}
	return { opener: text.slice(0, bodyStart), body: text.slice(bodyStart), closer: '', after: '' };
}

function cut(text: string, bodyStart: number, closerStart: number): Split {
	const closerEnd = closerStart + FENCE.length;
	return {
		opener: text.slice(0, bodyStart),
		body: text.slice(bodyStart, closerStart),
		closer: text.slice(closerStart, closerEnd),
		after: text.slice(closerEnd)
	};
}

function mathBodyRange(node: NodeView): { start: number; end: number } | null {
	const dollars = readSource(node.raw);
	if (dollars) {
		if (dollars.body === '') return null;
		const start = dollars.opener.length;
		return { start, end: start + displayLength(dollars.body) };
	}
	const anatomy = fenceAnatomy(node.raw);
	if (!anatomy || anatomy.closerStart === anatomy.bodyStart) return null;
	const body = node.raw.slice(anatomy.bodyStart, anatomy.closerStart);
	return { start: anatomy.bodyStart, end: anatomy.bodyStart + displayLength(body) };
}

function onOwnLines(body: string, caret: number, ending: LineEnding): Edit {
	const bodyEnd = FENCE.length + body.length;
	const shift = caret < FENCE.length ? 0 : caret <= bodyEnd ? ending.length : 2 * ending.length;
	return { text: blockLines(body).join(ending), caret: caret + shift };
}

function reshape(text: string, caret: number): Edit | null {
	const source = readSource(text);
	if (!source || source.opener !== FENCE || source.closer !== FENCE) return null;
	const ending = firstLineEnding(source.body);
	return ending ? onOwnLines(source.body, caret, ending) : null;
}

// Lines a literal write brought below a broken line 0 stay their own blocks unless the last one
// is exactly `$$`.
function legalSource(text: string, caret: number, authored: boolean, closerEnding: LineEnding) {
	const lines = displayLines(text);
	const brought =
		!authored &&
		lines.length > 1 &&
		lines[0].text.startsWith(FENCE) &&
		!opensBlock(lines[0].text) &&
		!isFenceLine(lines[lines.length - 1].text);
	if (brought) {
		const lineEnd = lines[0].text.length;
		return {
			text: text.slice(0, lineEnd) + FENCE + text.slice(lineEnd),
			caret: caret > lineEnd ? caret + FENCE.length : caret
		};
	}
	const reshaped = reshape(text, caret) ?? { text, caret };
	const source = readSource(reshaped.text);
	if (!source || source.closer) return reshaped;
	const shaped = displayLines(reshaped.text);
	// The closer goes in after every written byte, so no offset moves.
	if (isFenceLine(shaped[0].text)) {
		return { text: reshaped.text + closerEnding + FENCE, caret: reshaped.caret };
	}
	if (shaped.length === 1) return { text: reshaped.text + FENCE, caret: reshaped.caret };
	return onOwnLines(source.body, reshaped.caret, shaped[0].ending as LineEnding);
}

function writeBlock(raw: string, offset: number, ctx: WriteContext) {
	const display = trimTrailingLineEnding(raw);
	const tail = ownTrailingLineEnding(raw);
	const written = legalSource(
		display,
		Math.min(offset, display.length),
		ctx.mode === 'authored',
		trailingLineEnding(ctx.node.raw, ctx.lineEnding)
	);
	const intoTail = Math.min(Math.max(offset - display.length, 0), tail.length);
	return { raw: written.text + tail, offset: written.caret + intoTail };
}

const blockWrite: WriteRule = {
	normalize: (raw, ctx) => writeBlock(raw, 0, ctx).raw,
	mapOffset: (raw, offset, ctx) => writeBlock(raw, offset, ctx).offset,
	text: (raw) => {
		const source = readSource(raw);
		return source ? source.body + source.after : raw;
	}
};
