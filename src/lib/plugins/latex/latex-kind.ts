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
	declarePluginInlineKind,
	declarePluginKind,
	registerInlineSyntax,
	registerInlineWidgetKind,
	registerBlockKind,
	registerBlockOpener,
	isInlineKindDeclared,
	OPENER_PRIORITIES,
	type PluginInlineKind,
	type InlineNode,
	type CstNode
} from '$lib/plugin';
import MathInline from './MathInline.svelte';

export const MATH_INLINE = 'math';
export const MATH_BLOCK = 'mathBlock';

// ── Recognition ──────────────────────────────────────────────────────────────

const isWhitespace = (ch: string) => /\s/.test(ch);
const isDigit = (ch: string) => ch >= '0' && ch <= '9';

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

	for (let close = pos + 2; close < end; close++) {
		if (raw[close] !== '$') continue;
		if (isWhitespace(raw[close - 1])) continue;
		return { kind, start: pos, end: close + 1 };
	}
	return null;
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
		supportsInline: false
	});

	registerBlockOpener(mathBlock, {
		// `$$` collides with no built-in matcher, so priority is only collision
		// avoidance; sits just past the sibling verbatim fence (`fencedCode`) and
		// ties nothing (built-ins step by 10; the shared `:::` directive opener
		// sits at 45, the harness `<details>` opener at 65).
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
}
