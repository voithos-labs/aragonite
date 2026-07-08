/**
 * The first-party LaTeX extension's recognizers and widgets: inline `$…$` math
 * (recognizer + plugin inline kind + KaTeX live widget) and block `$$…$$` display
 * math (a source-holding leaf kind + block opener). Dev/e2e harness only — kept
 * out of `src/lib` so `svelte-package` never pulls `katex` into `dist/`.
 *
 * Recognition is gated on registration: with no extension loaded neither the
 * inline `$` trigger nor the block `$$` opener exists, so parsing stays
 * byte-identical to bare GFM.
 */

import {
	declarePluginInlineKind,
	declaredPluginInlineKind,
	declarePluginKind,
	registerInlineSyntax,
	registerInlineWidgetKind,
	registerBlockKind,
	registerBlockOpener,
	isBlockKindRegistered,
	type PluginInlineKind,
	type CstNode
} from '$lib/plugin';
import type { InlineNode } from '$lib/core/nodes';
import { createMemoizedRenderer, katexRenderer, type MathRenderer } from './math-renderer';

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

// ── Widget ───────────────────────────────────────────────────────────────────

/**
 * The atomic-widget shell for an inline math span. Carries the generic
 * `[data-inline-widget]` marker plus `data-source-start`/`-end` = the node's
 * offsets — the offset walk and Task 14's byte-survival audit key on exactly
 * these. Renders the `$`-stripped source in text mode via the injected renderer.
 */
export function buildMathWidget(node: InlineNode, raw: string, render: MathRenderer): HTMLElement {
	const shell = document.createElement('span');
	shell.className = 'math-inline-widget';
	shell.dataset.inlineWidget = '';
	shell.dataset.sourceStart = String(node.start);
	shell.dataset.sourceEnd = String(node.end);
	shell.setAttribute('contenteditable', 'false');

	const source = raw.slice(node.start + 1, node.end - 1);
	shell.appendChild(render(source, { display: false }).dom);
	return shell;
}

// ── Registration ─────────────────────────────────────────────────────────────

/** The barrel exposes no boolean inline-kind probe (block kinds have
 *  `isBlockKindRegistered`; inline kinds do not). `declaredPluginInlineKind`
 *  reads the same persistent declared-set the registries key on, so this stays
 *  correct under HMR re-import where a module-local flag would not. */
function isMathInlineRegistered(): boolean {
	try {
		declaredPluginInlineKind(MATH_INLINE);
		return true;
	} catch {
		return false;
	}
}

export function registerMathInline(): void {
	if (isMathInlineRegistered()) return; // idempotent for HMR / re-import
	const kind = declarePluginInlineKind(MATH_INLINE);
	const render = createMemoizedRenderer(katexRenderer);

	registerInlineSyntax('$', (raw, pos, end) => recognizeMath(raw, pos, end, kind));
	registerInlineWidgetKind(kind, {
		isWidget: () => true,
		buildWidget: (node, raw) => buildMathWidget(node, raw, render),
		editing: { deleteGranularity: 'select-then-delete', onEdge: 'select', revealSource: true }
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
	if (isBlockKindRegistered(MATH_BLOCK)) return; // idempotent for HMR / re-import
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
		// avoidance; 15 sits just past the sibling verbatim fence (fencedCode@10)
		// and ties nothing (built-ins step by 10; the callout/details harness use 45/65).
		priority: 15,
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
