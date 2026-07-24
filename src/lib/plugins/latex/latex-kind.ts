/**
 * The LaTeX plugin's recognizers and widgets: inline `$…$` math (recognizer +
 * plugin inline kind + live widget) and block `$$…$$` display math (a source-holding
 * leaf kind + block opener). Engine-free — the render engine is injected through the
 * `math-renderer` seam, never imported here.
 *
 * Recognition is gated on registration: with no extension loaded neither the
 * inline `$` trigger nor the block `$$` opener exists, so parsing stays
 * byte-identical to bare GFM.
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
 * Closer positions (`$` with a non-whitespace char before it) for one block's raw.
 * A forward search per consultation costs a full block scan every time it declines,
 * and a paragraph of shell prose (`$HOME $PATH $USER …`) declines at every `$` — so
 * the predicate, which reads only `raw`, is materialized once and each consultation
 * looks it up (the backtick-run index's shape). Bounded rather than weak-keyed
 * because a string cannot key a WeakMap; two entries cover a block's own scan, the
 * only place consecutive consultations share a `raw`.
 */
const closerIndex = createBoundedMemo<string, Int32Array>({ cap: 2 });

function indexMathClosers(raw: string): Int32Array {
	const positions: number[] = [];
	for (let i = 1; i < raw.length; i++) {
		if (raw[i] === '$' && !isWhitespace(raw[i - 1])) positions.push(i);
	}
	return Int32Array.from(positions);
}

/** First closer position at or after `from`, or -1 when the block holds none. */
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
 * `$`-flanking recognizer over `raw[pos, end)`, where `pos` is the opening `$`.
 * Opens only when the next char is neither whitespace nor a digit — the digit
 * guard is what keeps `$5` / `$5 and $10` currency, not math. Closes on the
 * first later `$` whose preceding char is non-whitespace; the close is
 * deliberately not digit-guarded, so `$x^2$` closes on its `2`.
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

	// The index spans the whole block, so `end` — not the block string — decides the
	// claim: a closer past the scan range leaves the `$` literal.
	const close = firstCloserFrom(raw, pos + 2);
	if (close === -1 || close >= end) return null;
	return { kind, start: pos, end: close + 1 };
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerMathInline(): void {
	// Keyed on the declared-inline-kind registry, not a module-local latch: the same
	// test reset that clears the inline syntax/widget registries this guards also
	// clears this key, so a reset → re-register re-runs the whole inline path cleanly.
	// The renderer is wired separately through the module seam (`setMathRenderer`),
	// so registration itself stays engine-free.
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
 * The inner LaTeX a stored math block renders: the `$$` fence stripped, or a
 * ```math / ~~~math fence reduced to its body (opener and closer lines dropped).
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

/**
 * A block-math opener line, at column 0: either a bare `$$` (multi-line fence, a
 * later bare `$$` closes it) or a closed single line `$$…$$` (length ≥ 4 keeps
 * the open/close pair disjoint). A `$$`-prefixed line that is neither — e.g.
 * `$$ x` with no same-line close — is not an opener and falls to a paragraph.
 */
function isBlockMathOpener(text: string): boolean {
	if (!text.startsWith(BLOCK_FENCE)) return false;
	if (text.length >= 4 && text.endsWith(BLOCK_FENCE)) return true;
	return text === BLOCK_FENCE;
}

export function registerMathBlock(): void {
	const mathBlock = declarePluginKind(MATH_BLOCK);

	// A source-holding leaf like `fencedCode`, not a container: no `container`
	// group, no children. `serialize` re-emits `leadingTrivia + raw`, so a `raw`
	// built from the exact fence bytes round-trips byte-for-byte.
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
		// `$$` collides with no built-in matcher, so priority is only collision
		// avoidance; sits just past the sibling verbatim fence (`fencedCode`) and
		// ties nothing.
		priority: OPENER_PRIORITIES.fencedCode + 5,
		interruptsParagraph: isBlockMathOpener,
		tryOpen(ctx) {
			const text = ctx.line.text;
			if (!text.startsWith(BLOCK_FENCE)) return null;

			if (text.length >= 4 && text.endsWith(BLOCK_FENCE)) {
				return {
					node: { kind: mathBlock, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw },
					nextIndex: ctx.index + 1
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
			return { node, nextIndex: i + 1 };
		}
	});

	// GitHub's third math form rides the same render component; co-registered here
	// so one install teaches both (the admonition/githubAlert precedent).
	registerMathFence();
}

// ── Fenced ```math display math ─────────────────────────────────────────────────
// GitHub's third math form: a fenced code block whose info string's first token is
// exactly `math`. A source-holding leaf like the `$$` block (raw authoritative,
// serialize re-emits leadingTrivia + raw), rendered by the same BlockMath component.

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
			// pinned by the latex-math-fence e2e (render + kind + reveal→edit→commit
			// round trip), which is a plugins battery, not the sim oracle.
			simOracle: { mode: 'inherit-default' }
		})
	});

	registerBlockOpener(mathFence, {
		// `fencedCode` accepts every fence, ```math included, so this must price
		// AHEAD of that superset matcher; a distinct slot below the sibling mermaid.
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
			// Unterminated declines (the sibling `$$` block's fence-decline behavior);
			// the built-in fencedCode then claims it as a plain `math` code block.
			if (closeIdx === -1) return null;

			const raw = ctx.lines
				.slice(ctx.index, closeIdx + 1)
				.map((l) => l.raw)
				.join('');
			const node: CstNode = { kind: mathFence, leadingTrivia: ctx.leadingTrivia, raw };
			return { node, nextIndex: closeIdx + 1 };
		}
	});
}
