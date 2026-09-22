/**
 * Inline `$…$` math and the two display-math block forms, as block kinds that hold their own
 * source. No renderer here: `math-renderer.ts` is handed one, and this file never imports one.
 * Recognition starts only once the plugin registers, so without it parsing stays byte-identical
 * to plain GFM.
 */

import {
	caretOffsetAtPoint,
	createScanIndex,
	declarePluginInlineKind,
	declarePluginKind,
	registerInlineSyntax,
	registerInlineWidgetKind,
	registerBlockKind,
	registerBlockOpener,
	isInlineKindDeclared,
	simpleLeafClosure,
	matchFenceOpen,
	matchFenceClose,
	OPENER_PRIORITIES,
	trimTrailingLineEnding,
	type CaretTarget,
	type PluginInlineKind,
	type InlineNode,
	type CstNode,
	type FenceOpen,
	type NodeView
} from '$lib/plugin';
import MathInline from './MathInline.svelte';
import { registerMathBlockCompleter } from './math-completion';

export const MATH_INLINE = 'math';
export const MATH_BLOCK = 'mathBlock';
export const MATH_FENCE = 'mathFence';

// ── Recognition ──────────────────────────────────────────────────────────────

const isWhitespace = (ch: string) => /\s/.test(ch);
const isDigit = (ch: string) => ch >= '0' && ch <= '9';

function indexDollars(raw: string): Int32Array {
	const positions: number[] = [];
	for (let i = 1; i < raw.length; i++) {
		if (raw[i] === '$') positions.push(i);
	}
	return Int32Array.from(positions);
}

// Indexed once per block, not searched per consultation: a paragraph of shell prose
// (`$HOME $PATH $USER …`) would otherwise cost a full block scan at every `$`.
const nextDollarFrom = createScanIndex(indexDollars);

/** Money, written the way prose writes it: a whole number between the delimiters. */
const isPriceSpan = (body: string) => /^\d[\d.,]*$/.test(body);

/**
 * Pandoc's rule, with one difference. A match always ends at the next `$`, whichever one that
 * is, and a closer that does not qualify leaves the opener literal; a closer needs a non-space
 * before it and no digit after it. Our addition: a span that is only a number is a price
 * (`$5$`), so a typed price stays prose.
 */
function recognizeMath(
	raw: string,
	pos: number,
	end: number,
	kind: PluginInlineKind
): InlineNode | null {
	const afterOpen = pos + 1;
	if (afterOpen >= end) return null;
	const opener = raw[afterOpen];
	if (isWhitespace(opener)) return null;
	// `$$` is the display fence, or the empty pair a keystroke just closed: never an inline
	// opener, or the match would end on the second `$` of its own opener.
	if (opener === '$') return null;

	// The index spans the whole block, so `end` is what decides: a closer past the scan
	// range leaves the `$` literal.
	const close = nextDollarFrom(raw, pos + 2);
	if (close === -1 || close >= end) return null;
	if (isWhitespace(raw[close - 1]) || isDigit(raw[close + 1] ?? '')) return null;
	if (isPriceSpan(raw.slice(afterOpen, close))) return null;
	return { kind, start: pos, end: close + 1 };
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerMathInline(): void {
	// Keyed on the kind registry, not a module latch, so the platform reset that clears
	// the inline registries also clears this guard.
	if (isInlineKindDeclared(MATH_INLINE)) return;
	const kind = declarePluginInlineKind(MATH_INLINE);
	registerInlineSyntax('$', (raw, pos, end) => recognizeMath(raw, pos, end, kind), {
		autoPair: true
	});
	registerInlineWidgetKind(kind, {
		isWidget: () => true,
		component: MathInline,
		editing: {
			revealSource: true,
			revealContentSpan: mathContentSpan,
			revealOffsetAtPoint: mathInlineOffsetAtPoint
		}
	});
}

// ── Caret from a click ───────────────────────────────────────────────────────
// KaTeX paints glyphs, not source bytes, so both forms read a click the same way: how far along
// the painted run it landed, scaled into the span that run renders.

/** `$…$`: one delimiter each side, so an edit stays inside the formula. */
const mathContentSpan = (source: string) =>
	source.length >= 2 ? { start: 1, end: source.length - 1 } : null;

function glyphOffsetInSpan(
	rendered: HTMLElement,
	span: { start: number; end: number },
	clientX: number,
	clientY: number
): number | null {
	// `.katex-html` is the half that is painted: the MathML copy beside it is clipped to a
	// pixel, and measuring both together answers for a point nobody clicked.
	const glyphs = rendered.querySelector<HTMLElement>('.katex-html');
	const along = glyphs ? caretOffsetAtPoint(glyphs, clientX, clientY) : null;
	const total = glyphs?.textContent?.length ?? 0;
	if (along === null || total === 0) return null;
	return span.start + Math.round((along / total) * (span.end - span.start));
}

function mathInlineOffsetAtPoint(
	widgetEl: HTMLElement,
	source: string,
	clientX: number,
	clientY: number
): number | null {
	const span = mathContentSpan(source);
	return span ? glyphOffsetInSpan(widgetEl, span, clientX, clientY) : null;
}

/** Where a click on the rendered equation puts the caret; the fence lines paint no glyphs of
 *  their own, so a point the glyphs cannot answer for goes to the body's end. */
function mathCaretAtPoint(
	blockEl: HTMLElement,
	clientX: number,
	clientY: number
): CaretTarget | null {
	const render = blockEl.querySelector<HTMLElement>('.math-block-render');
	if (!render) return null;
	const start = Number(render.dataset.bodyStart);
	const end = Number(render.dataset.bodyEnd);
	if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
	return { path: [], offset: glyphOffsetInSpan(render, { start, end }, clientX, clientY) ?? end };
}

// ── Rendered display source ────────────────────────────────────────────────────

/**
 * Shared by the render component so `mathBlock` and `mathFence` display identically.
 * Round-trip stays byte-level on `raw`, so this never feeds serialization.
 */
export function mathDisplaySource(source: string): string {
	if (/^[ \t]*(?:`{3,}|~{3,})/.test(source)) {
		const firstBreak = source.indexOf('\n');
		if (firstBreak === -1) return '';
		const body = source
			.slice(firstBreak + 1)
			.replace(/(?:\r?\n)?[ \t]*(?:`{3,}|~{3,})[ \t]*\r?\n?$/, '');
		return body.trim();
	}
	let inner = source;
	if (inner.startsWith('$$')) inner = inner.slice(2);
	if (inner.endsWith('$$')) inner = inner.slice(0, -2);
	return inner.trim();
}

// ── Writing a block's own bytes ────────────────────────────────────────────────

/** The line ending `raw` carries, or '' where it ends mid-line. */
const endingOf = (raw: string) => raw.slice(trimTrailingLineEnding(raw).length);

/** A CRLF document leaves a carriage return at the end of every line split on `\n`. */
function splitCarriageReturn(line: string): { text: string; cr: string } {
	return line.endsWith('\r') ? { text: line.slice(0, -1), cr: '\r' } : { text: line, cr: '' };
}

/**
 * Put back a closer a truncating write dropped, declared on both math kinds as
 * `normalizeRawWrite`. Bytes reaching a block this way never came from the user typing its fence,
 * so a range that ran out of the body leaves the block standing rather than degrading it to a
 * paragraph, the same answer a fenced code block gives. A first line that no longer opens the
 * block is left alone: those bytes have stopped being its syntax.
 */
function normalizeMathBlockRaw(raw: string, node: NodeView): string {
	const display = trimTrailingLineEnding(raw);
	const lines = display.split('\n');
	const { text, cr } = splitCarriageReturn(lines[0]);
	if (!text.startsWith(BLOCK_FENCE)) return raw;
	if (text === BLOCK_FENCE) {
		if (lines.slice(1).some((line) => splitCarriageReturn(line).text === BLOCK_FENCE)) return raw;
		return display + (endingOf(node.raw) || '\n') + BLOCK_FENCE + endingOf(raw);
	}
	if (isBlockMathOpener(text)) return raw;
	// The one-line form closes on line 0, so the lines a join brought along stay their own blocks.
	lines[0] = text + BLOCK_FENCE + cr;
	return lines.join('\n') + endingOf(raw);
}

/** The same rule for the ```math form, whose closer is always a line of its own. The run to close
 *  on comes from the written opener, not the block's old one. */
function normalizeMathFenceRaw(raw: string, node: NodeView): string {
	const display = trimTrailingLineEnding(raw);
	const lines = display.split('\n');
	const fence = matchMathFence(splitCarriageReturn(lines[0]).text);
	if (!fence) return raw;
	const closes = (line: string) =>
		matchFenceClose(splitCarriageReturn(line).text, fence.marker, fence.length);
	if (lines.slice(1).some(closes)) return raw;
	const closer = fence.indent + fence.marker.repeat(fence.length);
	return display + (endingOf(node.raw) || '\n') + closer + endingOf(raw);
}

// ── Block `$$…$$` display math ─────────────────────────────────────────────────

const BLOCK_FENCE = '$$';

/** The length ≥ 4 test keeps the open/close pair disjoint; anything else `$$`-prefixed
 *  (`$$ x` with no same-line close) is not an opener and falls to a paragraph. */
function isBlockMathOpener(text: string): boolean {
	if (!text.startsWith(BLOCK_FENCE)) return false;
	if (text.length >= 4 && text.endsWith(BLOCK_FENCE)) return true;
	return text === BLOCK_FENCE;
}

export function registerMathBlock(): void {
	const mathBlock = declarePluginKind(MATH_BLOCK);

	// A block that holds its own source, like `fencedCode`: `serialize` re-emits
	// `leadingTrivia + raw`, so a raw built from the exact fence bytes round-trips byte for byte.
	registerBlockKind(mathBlock, {
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		// The open source takes Enter as a literal newline and never splits, so neither edge
		// can grow a neighbouring block.
		gapEdges: 'both',
		conformanceFixture: '$$\nx^2\n$$\n',
		caretTargetAtPoint: mathCaretAtPoint,
		normalizeRawWrite: normalizeMathBlockRaw,
		closure: simpleLeafClosure({
			focus: {
				mode: 'implemented',
				via: 'createEditableLeaf render-primary reveal (source ⇄ rendered)'
			},
			selectionPaint: {
				mode: 'implemented',
				via: 'measurePartialRects (raw offsets) while the source is revealed'
			},
			searchPaint: {
				mode: 'implemented',
				via: 'source raw scanned and navigable; while folded, createEditableLeaf covers the rendered block box (opaque single-unit fallback)'
			},
			undo: {
				mode: 'implemented',
				via: 'render-primary — the reveal→edit→blur cycle commits as one undo entry'
			},
			simOracle: { mode: 'implemented', via: 'block-math editable-leaf e2e' }
		})
	});

	registerBlockOpener(mathBlock, {
		// `$$` collides with no built-in matcher, so this number only keeps it from tying.
		priority: OPENER_PRIORITIES.fencedCode + 5,
		interruptsParagraph: isBlockMathOpener,
		tryOpen(ctx) {
			const text = ctx.line.text;
			if (!text.startsWith(BLOCK_FENCE)) return null;

			if (text.length >= 4 && text.endsWith(BLOCK_FENCE)) {
				return {
					node: { kind: mathBlock, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw },
					consumed: 1
				};
			}
			if (text !== BLOCK_FENCE) return null;

			let i = ctx.index + 1;
			while (i < ctx.end && ctx.lines[i].text !== BLOCK_FENCE) i++;
			if (i >= ctx.end) return null; // unterminated fence declines to paragraph

			const raw = ctx.lines
				.slice(ctx.index, i + 1)
				.map((l) => l.raw)
				.join('');
			const node: CstNode = { kind: mathBlock, leadingTrivia: ctx.leadingTrivia, raw };
			return { node, consumed: i + 1 - ctx.index };
		}
	});

	// The open/close pair needs its lines adjacent, which Enter alone can never type.
	registerMathBlockCompleter(mathBlock);

	// Registered together so one install adds both forms, as admonitions and alerts do.
	registerMathFence();
}

// ── Fenced ```math display math ─────────────────────────────────────────────────
// GitHub's third math form: a block holding its own source, like the `$$` block, rendered by
// the same component.

const FENCE_INFO_TOKEN = 'math';

function matchMathFence(text: string): FenceOpen | null {
	const fence = matchFenceOpen(text);
	return fence && fence.info.split(/\s+/)[0] === FENCE_INFO_TOKEN ? fence : null;
}

export function registerMathFence(): void {
	const mathFence = declarePluginKind(MATH_FENCE);

	registerBlockKind(mathFence, {
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		gapEdges: 'both',
		caretTargetAtPoint: mathCaretAtPoint,
		conformanceFixture: '```math\nx^2\n```\n',
		normalizeRawWrite: normalizeMathFenceRaw,
		closure: simpleLeafClosure({
			focus: {
				mode: 'implemented',
				via: 'createEditableLeaf render-primary reveal (source ⇄ rendered)'
			},
			selectionPaint: {
				mode: 'implemented',
				via: 'measurePartialRects (raw offsets) while the source is revealed'
			},
			searchPaint: {
				mode: 'implemented',
				via: 'source raw scanned and navigable; while folded, createEditableLeaf covers the rendered block box (opaque single-unit fallback)'
			},
			undo: {
				mode: 'implemented',
				via: 'render-primary reveal→edit→blur cycle commits as one undo entry'
			},
			// No note-taking simulation drives a ```math fence; its interactive path is pinned
			// by the plugins e2e battery instead.
			simOracle: { mode: 'inherit-default' }
		})
	});

	registerBlockOpener(mathFence, {
		// `fencedCode` accepts every fence, ```math included, so this has to be tried before
		// it, at a priority of its own just below mermaid's.
		priority: OPENER_PRIORITIES.fencedCode - 4,
		interruptsParagraph: (line) => matchMathFence(line) !== null,
		tryOpen(ctx) {
			const fence = matchMathFence(ctx.line.text);
			if (!fence) return null;

			let closeIdx = -1;
			for (let i = ctx.index + 1; i < ctx.end; i++) {
				if (matchFenceClose(ctx.lines[i].text, fence.marker, fence.length)) {
					closeIdx = i;
					break;
				}
			}
			// An unterminated fence backs out, so the built-in fencedCode takes it as a plain
			// `math` code block, matching the `$$` block.
			if (closeIdx === -1) return null;

			const raw = ctx.lines
				.slice(ctx.index, closeIdx + 1)
				.map((l) => l.raw)
				.join('');
			const node: CstNode = { kind: mathFence, leadingTrivia: ctx.leadingTrivia, raw };
			return { node, consumed: closeIdx + 1 - ctx.index };
		}
	});
}
