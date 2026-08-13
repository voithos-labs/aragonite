/**
 * What a marker-hiding mode leaves on screen. `inline-render.ts` decides which bytes become which
 * span; this decides which of those spans the reader sees, and it is the one home for that rule:
 * the DOM walk (`cursor/widget-offset.ts`) is its other consumer, in the space that has a caret.
 * The two answers are held together by `test/invariants/screen-truth.property.test.ts`, not by
 * convention. Context vocabulary: `docs/design/live-mode.md` § 2.
 */

import type { InlineNode } from '../nodes';
import { renderInlineNodes, type RenderInlineOptions } from '../inline-render';
import { widgetSourceRange } from './inline-widgets';
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
 * The content behind every marker family, whatever the container paints: the reading a rewrite's
 * before/after conservation diff needs, since chrome folds the moment content arrives and a diff
 * against the screen would read that fold as bytes lost. Sound only past a
 * {@link paintsOnlyChrome} gate — over chrome the reader IS looking at, this reading calls those
 * bytes unseen and licenses dropping them.
 */
export const CONTENT_VISIBILITY: VisibilityContext = { hidesMarkers: true, chromePaints: false };

/** A container whose chrome stands over no content: every family the override paints does. */
const CHROME_STANDS_ALONE: VisibilityContext = { hidesMarkers: true, chromePaints: true };

/** Whether a `family` span paints NOTHING under `ctx` — the one hiding rule, before any preview
 *  reveal. */
export function familyHidesText(family: MarkerFamily, ctx: VisibilityContext): boolean {
	return ctx.hidesMarkers && !(ctx.chromePaints && familyPaintsAlone(family));
}

// ── The reader's text ────────────────────────────────────────────────────────

/**
 * One stretch of `raw` as the reader meets it. `text` is what it paints, which is not always
 * `raw.slice(start, end)`: an atomic widget substitutes its own.
 */
export interface VisibleRun {
	start: number;
	end: number;
	text: string;
	visible: boolean;
}

/**
 * `nodes` as runs of raw bytes, each carrying what it paints under `ctx`. Read off the rendered
 * DOM rather than derived per kind, because which bytes a construct shows only the painter
 * answers (G4.33): a caller re-deriving that drifts from what paints, which is the only thing the
 * answer is worth anything as. Top-level nodes render one at a time, so a CLIPPED list (a join
 * seam's surviving side) keeps honest offsets instead of a running count that assumes contiguity.
 */
export function visibleRuns(
	nodes: readonly InlineNode[],
	raw: string,
	ctx: VisibilityContext,
	opts: RenderInlineOptions = {}
): VisibleRun[] {
	const runs: VisibleRun[] = [];
	for (const node of nodes) {
		collectRuns(renderInlineNodes([node], raw, opts), node.start, ctx, runs);
	}
	return runs;
}

/** The text a reader SEES for `nodes` — every run `ctx` leaves on screen, in source order. */
export function renderedText(
	nodes: readonly InlineNode[],
	raw: string,
	ctx: VisibilityContext,
	opts: RenderInlineOptions = {}
): string {
	let out = '';
	for (const run of visibleRuns(nodes, raw, ctx, opts)) if (run.visible) out += run.text;
	return out;
}

/**
 * Whether `nodes` are chrome standing over nothing, and therefore ALL on screen (live-mode.md
 * § 4.1). The inline half of the content-empty stamp, for a seam with no DOM to read the stamp
 * off: a license over bytes the reader never saw has nothing to claim here. A block's OWN chrome
 * (a `## ` prefix, a fence line) sits outside the inline content range, so an empty one answers
 * false and the surfaces that own it are unaffected.
 */
export function paintsOnlyChrome(
	nodes: readonly InlineNode[],
	raw: string,
	opts: RenderInlineOptions = {}
): boolean {
	return (
		renderedText(nodes, raw, CONTENT_VISIBILITY, opts) === '' &&
		renderedText(nodes, raw, CHROME_STANDS_ALONE, opts) !== ''
	);
}

function collectRuns(
	fragment: DocumentFragment,
	start: number,
	ctx: VisibilityContext,
	out: VisibleRun[]
): void {
	let at = start;
	const visit = (dom: Node, hidden: boolean): void => {
		if (dom.nodeType === Node.TEXT_NODE) {
			const text = dom.textContent ?? '';
			out.push({ start: at, end: at + text.length, text, visible: !hidden });
			at += text.length;
			return;
		}
		if (dom.nodeType !== Node.ELEMENT_NODE) return;
		const el = dom as Element;
		// Only an atomic widget's shell carries a source range here, and it is the one element
		// whose text is not its bytes — so the range is both the test and the re-sync.
		const source = widgetSourceRange(el);
		if (source !== null) {
			out.push({ ...source, text: el.textContent ?? '', visible: !hidden });
			at = source.end;
			return;
		}
		const family = markerFamilyOf(el);
		const inner = hidden || (family !== null && familyHidesText(family, ctx));
		for (const child of el.childNodes) visit(child, inner);
	};
	for (const child of fragment.childNodes) visit(child, false);
}
