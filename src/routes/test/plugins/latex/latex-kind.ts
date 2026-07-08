/**
 * Inline `$…$` math for the first-party LaTeX extension: the recognizer, the
 * plugin inline kind, and the KaTeX-backed live widget. Dev/e2e harness only —
 * kept out of `src/lib` so `svelte-package` never pulls `katex` into `dist/`.
 *
 * Recognition is gated on registration: with no extension loaded the scanner
 * never sees a `$` trigger, so inline parsing stays byte-identical to bare GFM.
 */

import {
	declarePluginInlineKind,
	declaredPluginInlineKind,
	registerInlineSyntax,
	registerInlineWidgetKind,
	type PluginInlineKind
} from '$lib/plugin';
import type { InlineNode } from '$lib/core/nodes';
import { createMemoizedRenderer, katexRenderer, type MathRenderer } from './math-renderer';

export const MATH_INLINE = 'math';

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
