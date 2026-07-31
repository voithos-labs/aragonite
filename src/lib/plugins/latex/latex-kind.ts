/**
 * Inline `$…$` math and the two display-math block forms, as source-holding leaf
 * kinds. Engine-free: the render engine is injected through the `math-renderer` seam,
 * never imported here. Recognition is gated on registration, so with no extension
 * loaded parsing stays byte-identical to bare GFM.
 */

import {
	createBoundedMemo,
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
	type PluginInlineKind,
	type InlineNode,
	type CstNode,
	type FenceOpen
} from '$lib/plugin';
import MathInline from './MathInline.svelte';

export const MATH_INLINE = 'math';
export const MATH_BLOCK = 'mathBlock';
export const MATH_FENCE = 'mathFence';

// ── Recognition ──────────────────────────────────────────────────────────────

const isWhitespace = (ch: string) => /\s/.test(ch);
const isDigit = (ch: string) => ch >= '0' && ch <= '9';

/**
 * Materialized once per block, not searched per consultation: a paragraph of shell
 * prose (`$HOME $PATH $USER …`) declines at every `$`, each costing a full block scan.
 * Bounded rather than weak-keyed because a string cannot key a WeakMap.
 */
const closerIndex = createBoundedMemo<string, Int32Array>({ cap: 2 });

function indexMathClosers(raw: string): Int32Array {
	const positions: number[] = [];
	for (let i = 1; i < raw.length; i++) {
		if (raw[i] === '$' && !isWhitespace(raw[i - 1])) positions.push(i);
	}
	return Int32Array.from(positions);
}

function firstCloserFrom(raw: string, from: number): number {
	const positions = closerIndex(raw, () => indexMathClosers(raw));
	let lo = 0;
	let hi = positions.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (positions[mid] < from) lo = mid + 1;
		else hi = mid;
	}
	return lo < positions.length ? positions[lo] : -1;
}

/**
 * The digit guard on the opener is what keeps `$5 and $10` currency, not math. The
 * close is deliberately not digit-guarded, so `$x^2$` closes on its `2`.
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
	if (isWhitespace(opener) || isDigit(opener)) return null;

	// The index spans the whole block, so `end` decides the claim: a closer past the
	// scan range leaves the `$` literal.
	const close = firstCloserFrom(raw, pos + 2);
	if (close === -1 || close >= end) return null;
	return { kind, start: pos, end: close + 1 };
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerMathInline(): void {
	// Keyed on the kind registry, not a module latch, so the platform reset that clears
	// the inline registries also clears this guard.
	if (isInlineKindDeclared(MATH_INLINE)) return;
	const kind = declarePluginInlineKind(MATH_INLINE);
	registerInlineSyntax('$', (raw, pos, end) => recognizeMath(raw, pos, end, kind));
	registerInlineWidgetKind(kind, {
		isWidget: () => true,
		component: MathInline,
		editing: { revealSource: true }
	});
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

	// A source-holding leaf like `fencedCode`: `serialize` re-emits `leadingTrivia + raw`,
	// so a raw built from the exact fence bytes round-trips byte-for-byte.
	registerBlockKind(mathBlock, {
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		conformanceFixture: '$$\nx^2\n$$\n',
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
		// `$$` collides with no built-in matcher, so this slot is only tie avoidance.
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

	// Co-registered so one install teaches both forms (the admonition/githubAlert precedent).
	registerMathFence();
}

// ── Fenced ```math display math ─────────────────────────────────────────────────
// GitHub's third math form: a source-holding leaf like the `$$` block, rendered by
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
		conformanceFixture: '```math\nx^2\n```\n',
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
			// No note-taking simulation drives a ```math fence; the interactive path is
			// pinned by the latex-math-fence e2e, a plugins battery rather than the oracle.
			simOracle: { mode: 'inherit-default' }
		})
	});

	registerBlockOpener(mathFence, {
		// `fencedCode` accepts every fence, ```math included, so this must price ahead of
		// that superset matcher, in its own slot below the sibling mermaid.
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
			// Unterminated declines so the built-in fencedCode claims it as a plain
			// `math` code block, matching the sibling `$$` block.
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
