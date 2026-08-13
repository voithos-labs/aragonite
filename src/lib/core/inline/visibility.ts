/**
 * What a marker-hiding mode leaves on screen. `inline-render.ts` decides which bytes become which
 * span; this decides which of those spans the reader sees, and it is the one home for that rule:
 * the DOM walk (`cursor/widget-offset.ts`) is its other consumer, in the space that has a caret.
 * The two answers are held together by `test/invariants/screen-truth.property.test.ts`, not by
 * convention. Context vocabulary: `docs/design/live-mode.md` § 2.
 */

import type { InlineNode } from '../nodes';
import { renderInlineNodes, type RenderInlineOptions } from '../inline-render';
import { type PresentationMode } from '../../presentation-mode';

// ── The families ─────────────────────────────────────────────────────────────

/** The span families a marker-hiding mode drops. `fence-line` is a block's own chrome, minted
 *  outside this file, and is named here because the hiding rule is one rule. */
export type MarkerFamily = 'marker' | 'fence-line' | 'ref-label';

const FAMILY_CLASS: Record<MarkerFamily, string> = {
	marker: 'md-marker',
	'fence-line': 'md-fence-line',
	'ref-label': 'md-ref-label'
};

/** Every family at once, for a caller reading spans back out of a rendered fragment. */
export const MARKER_FAMILY_SELECTOR = Object.values(FAMILY_CLASS)
	.map((cls) => `.${cls}`)
	.join(', ');

/**
 * The family `el` belongs to, or null for anything else. A `contenteditable="false"` marker is
 * the ambient prefix island, which keeps its box in every mode (`ambient/ambient-cursor.ts`), so
 * it belongs to no family.
 */
export function markerFamilyOf(el: Element): MarkerFamily | null {
	const classes = el.classList;
	if (classes.contains(FAMILY_CLASS.marker)) {
		return el.getAttribute('contenteditable') === 'false' ? null : 'marker';
	}
	if (classes.contains(FAMILY_CLASS['fence-line'])) return 'fence-line';
	if (classes.contains(FAMILY_CLASS['ref-label'])) return 'ref-label';
	return null;
}

/** Whether the content-empty override paints `family` (`styles/editor.css`, same scoping). A
 *  reference label is resolution metadata rather than chrome a caret types against, so it stays
 *  hidden, and a container holding only labels has no paint to promise. */
export function familyPaintsAlone(family: MarkerFamily): boolean {
	return family !== 'ref-label';
}

// ── The context ──────────────────────────────────────────────────────────────

/** What a container does to the marker spans rendered into it. Minted only by the two readings
 *  below, so a call site states which question it is asking rather than two loose booleans. */
export interface VisibilityContext {
	/** Whether marker spans drop at all — false in source mode, where every byte is on screen. */
	readonly hidesMarkers: boolean;
	/** Whether the container's chrome stands over no content and therefore paints anyway. */
	readonly chromePaints: boolean;
}

/**
 * What the reader sees on a container painting under `mode`. `chromePaints` is that container's
 * own stamp condition (live-mode.md § 4.1), which reading declines: it takes no keystrokes, so a
 * construct with nothing behind its chrome may paint nothing there. The preview rungs' per-span
 * reveal is DOM state and stays with the walk; this answers for an unrevealed container.
 */
export function screenVisibility(
	mode: PresentationMode,
	container: { chromePaints: boolean }
): VisibilityContext {
	switch (mode) {
		case 'source':
			return { hidesMarkers: false, chromePaints: false };
		case 'reading':
			return { hidesMarkers: true, chromePaints: false };
		case 'live':
		case 'preview-block':
		case 'preview-inline':
			return { hidesMarkers: true, chromePaints: container.chromePaints };
		default: {
			const unhandled: never = mode;
			return unhandled;
		}
	}
}

/**
 * The content behind every marker family, whatever the container paints. The reading a rewrite's
 * before/after conservation diff needs: chrome folds the moment content arrives, so a diff taken
 * against the screen reads that fold as bytes lost
 * (`e2e/requirements/presentation/presentation-live-opener-typing.md`).
 */
export const CONTENT_VISIBILITY: VisibilityContext = { hidesMarkers: true, chromePaints: false };

/** Whether a `family` span paints NOTHING under `ctx` — the one hiding rule, before any preview
 *  reveal. */
export function familyHidesText(family: MarkerFamily, ctx: VisibilityContext): boolean {
	return ctx.hidesMarkers && !(ctx.chromePaints && familyPaintsAlone(family));
}

// ── The reader's text ────────────────────────────────────────────────────────

/**
 * The text a reader SEES for `nodes` — the rendered DOM minus every span `ctx` drops. Asked of
 * the render path rather than derived per kind, because which bytes a construct shows only the
 * painter answers (G4.33): a caller re-deriving it drifts from what actually paints, which is the
 * only thing the answer is worth anything as.
 */
export function renderedText(
	nodes: InlineNode[],
	raw: string,
	ctx: VisibilityContext,
	opts: RenderInlineOptions = {}
): string {
	const fragment = renderInlineNodes(nodes, raw, opts);
	for (const span of fragment.querySelectorAll(MARKER_FAMILY_SELECTOR)) {
		const family = markerFamilyOf(span);
		if (family !== null && familyHidesText(family, ctx)) span.remove();
	}
	return fragment.textContent ?? '';
}
