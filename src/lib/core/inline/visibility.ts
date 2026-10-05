/**
 * What a marker-hiding mode leaves on screen. `inline-render.ts` decides which bytes become which
 * span; this file decides which of those spans the user sees, and it is the one place that rule
 * lives: the DOM traversal (`cursor/widget-offset.ts`) reads it too, and a property test
 * (`screen-truth.property.test.ts`) holds the two answers together. Terms: `live-mode.md` § 2.
 */

import type { InlineNode } from '../nodes';
import { renderInlineNodes, type RenderInlineOptions } from '../inline-render';
import { widgetSourceRange } from './inline-widgets';
import { type PresentationMode } from '../../presentation-mode';
import { recordScreenRead } from '../../perf/instruments';

// ── The families ─────────────────────────────────────────────────────────────

/** The span families a marker-hiding mode drops. `fence-line` spans are a block's own fence lines,
 *  created outside this file, and are named here because the hiding rule is one rule. */
export type MarkerFamily = 'marker' | 'fence-line' | 'ref-label' | 'code-fence';

const FAMILY_CLASS: Record<MarkerFamily, string> = {
	marker: 'md-marker',
	'fence-line': 'md-fence-line',
	'ref-label': 'md-ref-label',
	// An inline code span's backticks, painted as the ends of the code chip where they show.
	'code-fence': 'md-code-fence'
};

/** Every family's class, so a scan of the source names each family the day it is added. */
export const MARKER_FAMILY_CLASSES: readonly string[] = Object.values(FAMILY_CLASS);

/** Every family at once, for a caller reading spans back out of a rendered fragment. */
export const MARKER_FAMILY_SELECTOR = MARKER_FAMILY_CLASSES.map((cls) => `.${cls}`).join(', ');

/**
 * Whether `el` is a container's leading marker prefix (`> `, `- `): the read-only marker span a
 * container draws before its first child's text, which keeps its box in every mode.
 */
export function isMarkerPrefixSpan(el: Element): boolean {
	return (
		el.classList.contains(FAMILY_CLASS.marker) && el.getAttribute('contenteditable') === 'false'
	);
}

/** The family `el` belongs to, or null for anything else. A marker prefix span belongs to none,
 *  since no mode hides it. */
export function markerFamilyOf(el: Element): MarkerFamily | null {
	const classes = el.classList;
	if (classes.contains(FAMILY_CLASS.marker)) return isMarkerPrefixSpan(el) ? null : 'marker';
	if (classes.contains(FAMILY_CLASS['fence-line'])) return 'fence-line';
	if (classes.contains(FAMILY_CLASS['ref-label'])) return 'ref-label';
	if (classes.contains(FAMILY_CLASS['code-fence'])) return 'code-fence';
	return null;
}

/** Whether `mode` shows a `family` span of a construct the caret is in (`construct-reveal.ts`):
 *  preview-inline shows every family there, live mode only a code span's backticks. */
export function caretShowsFamily(mode: PresentationMode, family: MarkerFamily): boolean {
	return mode === 'preview-inline' || (mode === 'live' && family === 'code-fence');
}

const shownSelectors = new Map<PresentationMode, string | null>();

/** Every span `mode` shows at the caret, as one selector, or null where the caret shows none: a
 *  block holding none of them has nothing the caret could reveal. */
export function caretShownSelector(mode: PresentationMode): string | null {
	if (!shownSelectors.has(mode)) {
		const families = (Object.keys(FAMILY_CLASS) as MarkerFamily[]).filter((family) =>
			caretShowsFamily(mode, family)
		);
		const selector = families.map((family) => `.${FAMILY_CLASS[family]}`).join(', ');
		shownSelectors.set(mode, selector === '' ? null : selector);
	}
	return shownSelectors.get(mode) ?? null;
}

/** How preview-inline shows a `family` span in the focused block: with the focus, by the reveal
 *  class alone, or by the class where its construct is tagged and with the focus where not (a cell). */
export function previewInlineReveal(family: MarkerFamily): 'focus' | 'class' | 'tag' {
	if (family === 'fence-line') return 'focus';
	return family === 'ref-label' ? 'class' : 'tag';
}

/** Whether the content-empty override in `styles/editor.css` shows `family`. A reference label
 *  is lookup metadata, not a marker the caret types against, so it stays hidden. */
export function familyPaintsAlone(family: MarkerFamily): boolean {
	return family !== 'ref-label';
}

// ── The context ──────────────────────────────────────────────────────────────

/** What a container does to the marker spans rendered into it. Built only by the two readings
 *  below, so a call site states which question it is asking rather than two loose booleans. */
export interface VisibilityContext {
	/** Whether marker spans drop at all: false in source mode, where every byte is on screen. */
	readonly hidesMarkers: boolean;
	/** Whether the container's markers stand over no content and therefore stay visible. */
	readonly chromePaints: boolean;
	/** Whether inline code backticks drop too: everywhere but source mode, until the caret's own
	 *  code span shows them (`construct-reveal.ts`); reading mode never shows them. */
	readonly hidesCodeFences: boolean;
}

/** Reading mode ignores the content-empty condition (live-mode.md § 4.1), since it takes no
 *  keystrokes. Answers for an unrevealed container: a preview's per-span reveal is DOM state. */
export function screenVisibility(
	mode: PresentationMode,
	container: { chromePaints: boolean; revealsCodeFence?: boolean }
): VisibilityContext {
	switch (mode) {
		case 'source':
			return { hidesMarkers: false, chromePaints: false, hidesCodeFences: false };
		case 'reading':
			return { hidesMarkers: true, chromePaints: false, hidesCodeFences: true };
		case 'live':
		case 'preview-block':
		case 'preview-inline':
			return {
				hidesMarkers: true,
				chromePaints: container.chromePaints,
				hidesCodeFences: !container.revealsCodeFence
			};
		default: {
			const unhandled: never = mode;
			return unhandled;
		}
	}
}

/** The content behind every marker family, for a rewrite's before/after comparison. Sound only
 *  behind a {@link paintsOnlyChrome} check, or it lets visible markers drop (live-mode.md § 2). */
export const CONTENT_VISIBILITY: VisibilityContext = {
	hidesMarkers: true,
	chromePaints: false,
	hidesCodeFences: true
};

/** A container whose markers stand over no content: every family the override shows is visible. */
const CHROME_STANDS_ALONE: VisibilityContext = {
	hidesMarkers: true,
	chromePaints: true,
	hidesCodeFences: false
};

/** Whether a `family` span shows nothing under `ctx`: the one hiding rule, before any preview
 *  reveal. */
export function familyHidesText(family: MarkerFamily, ctx: VisibilityContext): boolean {
	if (family === 'code-fence') return ctx.hidesCodeFences;
	return ctx.hidesMarkers && !(ctx.chromePaints && familyPaintsAlone(family));
}

// ── The reader's text ────────────────────────────────────────────────────────

/**
 * One stretch of `raw` as the user sees it. `text` is what it shows, which is not always
 * `raw.slice(start, end)`: a widget substitutes its own.
 */
export interface VisibleRun {
	start: number;
	end: number;
	text: string;
	visible: boolean;
}

/** Read off the rendered DOM, since only the renderer knows which bytes a construct shows
 *  (G4.33). Each top-level node renders alone, so a clipped list keeps its offsets. */
export function visibleRuns(
	nodes: readonly InlineNode[],
	raw: string,
	ctx: VisibilityContext,
	opts: RenderInlineOptions
): VisibleRun[] {
	recordScreenRead();
	const runs: VisibleRun[] = [];
	for (const node of nodes) {
		collectRuns(renderInlineNodes([node], raw, opts), node.start, ctx, runs);
	}
	return runs;
}

/** The text the user sees for `nodes`: every run `ctx` leaves on screen, in source order. */
export function renderedText(
	nodes: readonly InlineNode[],
	raw: string,
	ctx: VisibilityContext,
	opts: RenderInlineOptions
): string {
	let out = '';
	for (const run of visibleRuns(nodes, raw, ctx, opts)) if (run.visible) out += run.text;
	return out;
}

/** Whether `nodes` are markers over no content, which stay on screen (live-mode.md § 4.1). A
 *  block's own markers (`## `, a fence) sit outside the inline range: an empty block is false. */
export function paintsOnlyChrome(
	nodes: readonly InlineNode[],
	raw: string,
	opts: RenderInlineOptions
): boolean {
	return (
		renderedText(nodes, raw, CONTENT_VISIBILITY, opts) === '' &&
		renderedText(nodes, raw, CHROME_STANDS_ALONE, opts) !== ''
	);
}

/** One pending DOM node plus the hiding state it inherits from its ancestors. */
interface RunFrame {
	dom: Node;
	hidden: boolean;
}

function collectRuns(
	fragment: DocumentFragment,
	start: number,
	ctx: VisibilityContext,
	out: VisibleRun[]
): void {
	let at = start;
	const stack: RunFrame[] = [];
	// Reversed push, so pop order is source order, which `at` advances along.
	const pushChildren = (parent: Node, hidden: boolean) => {
		const children = parent.childNodes;
		for (let i = children.length - 1; i >= 0; i--) stack.push({ dom: children[i], hidden });
	};
	pushChildren(fragment, false);
	while (stack.length > 0) {
		const { dom, hidden } = stack.pop()!;
		if (dom.nodeType === Node.TEXT_NODE) {
			const text = dom.textContent ?? '';
			out.push({ start: at, end: at + text.length, text, visible: !hidden });
			at += text.length;
			continue;
		}
		if (dom.nodeType !== Node.ELEMENT_NODE) continue;
		const el = dom as Element;
		// Only a widget's shell carries a source range here, and it is the one element whose text
		// is not its bytes, so the range is both the test and the re-sync.
		const source = widgetSourceRange(el);
		if (source !== null) {
			out.push({ ...source, text: el.textContent ?? '', visible: !hidden });
			at = source.end;
			continue;
		}
		const family = markerFamilyOf(el);
		pushChildren(el, hidden || (family !== null && familyHidesText(family, ctx)));
	}
}
