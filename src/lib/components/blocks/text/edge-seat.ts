/**
 * Which side of a construct's hidden marker run a typed byte belongs to: a run drawn at zero width
 * leaves one screen position standing for two raw offsets. The kind's `edgeAffinity` policy answers
 * first (a link never extends), the side the caret arrived from second, and the render has the last
 * word (live-mode.md § 2), since a position that reads right can parse wrong.
 */

import type { AnyInlineKind, InlineNode } from '../../../core/nodes';
import type { EdgeAffinity, PinnedOffset } from '../../../caret/edge-affinity';
import { constructContentRange, inlineDescendants, readInline } from '../../../core/inline';
import {
	CONTENT_VISIBILITY,
	renderedText,
	visibleRuns,
	type VisibilityContext
} from '../../../core/inline/visibility';
import type { ContentRange } from '../../../core/inline';
import {
	getInlineConstructPolicy,
	type InlineConstructPolicy
} from '../../../schema/inline-construct-policy';
import type { GrammarView } from '../../../schema/block-openers';
import type { Reading } from '../../../schema/reading';
import { insertsExactly } from './screen-diff';
import type { CaretMemory } from '../../../caret/caret-memory';
import type { PlacedEdit, PlaceInsertion } from '../../../caret/next-insertion';
import type { HeldSpaceView } from '../../../caret/held-space';
import type { NodeView } from '../../../core/node-views';
import { resolvedInlineContent } from '../../../core/inline/inline-cache';
import { withOwnEnding } from '../surface-write';
import { revealsNoMarkers, screenVisibilityOf } from '../../../caret/widget-offset';

export interface EdgeSeat {
	/** Raw offset the byte must be written at. */
	offset: number;
	/** The construct whose hidden edge the caret sat at, which need not be the one holding
	 *  `offset`: a screen position reaches the runs abutting that construct's own. */
	kind: AnyInlineKind;
}

/** Where `typed` belongs when the caret sits at `caretOffset`, or null to let it land at the caret.
 *  `reading` must be the one `inlines` was read with, or a reference link reads as brackets. */
export function resolveEdgeSeat(
	caretOffset: number,
	inlines: readonly InlineNode[],
	affinity: EdgeAffinity | null,
	raw: string,
	screen: VisibilityContext,
	typed: string,
	reading: Reading
): EdgeSeat | null {
	const { grammar } = reading;
	const runs = markerRuns(inlines, raw, screen, grammar);
	const run = runAt(caretOffset, runs);
	if (!run) return null;
	const policy = getInlineConstructPolicy(run.kind);
	if (!policy) return null;
	const content = contentBounds(inlines);
	// What the user sees, asked of the renderer (G4.33), in the content reading: this only adds
	// bytes, so no reading of it can license dropping one.
	const shown = (bytes: string, end: number): string =>
		renderedText(
			readInline(bytes, content.start, end, reading.resolver, grammar),
			bytes,
			CONTENT_VISIBILITY,
			{ grammar }
		);
	const before = shown(raw, content.end);
	const holds = (offset: number): boolean => {
		const candidate = raw.slice(0, offset) + typed + raw.slice(offset);
		const after = shown(candidate, content.end + typed.length);
		return insertsExactly(before, after, typed);
	};
	for (const offset of candidateOffsets(run, policy.edgeAffinity, affinity, caretOffset, runs)) {
		// The DOM-to-offset traversal and Chromium's insertion normalise the same way, so a
		// verified answer equal to the caret means ordinary typing already lands there.
		if (offset === caretOffset) {
			if (holds(offset)) return null;
			continue;
		}
		if (holds(offset)) return { offset, kind: run.kind };
	}
	return null;
}

/** `typed`, inserted at `at` in `before`, written where the edge resolver puts it, or null where
 *  it already lands there. `caret` counts only where it names the same screen position as `at`. */
export function relocateInsertion(
	before: string,
	at: number,
	typed: string,
	inlines: readonly InlineNode[],
	affinity: EdgeAffinity | null,
	screen: VisibilityContext,
	reading: Reading,
	caret = at
): PlacedEdit | null {
	const samePosition =
		caret === at || seatOffsetsAt(at, inlines, before, screen, reading.grammar).includes(caret);
	const from = samePosition ? caret : at;
	const seat = resolveEdgeSeat(from, inlines, affinity, before, screen, typed, reading);
	if (!seat || seat.offset === at) return null;
	const lo = Math.min(seat.offset, at);
	const hi = Math.max(seat.offset, at);
	const crossed = [...inlineDescendants(inlines)].flatMap((node) => {
		const content = constructContentRange(node);
		const edge = (offset: number) => offset >= lo && offset <= hi;
		return content && (edge(content.start) || edge(content.end)) ? [node.kind] : [];
	});
	return {
		text: before.slice(0, seat.offset) + typed + before.slice(seat.offset),
		caretAfter: seat.offset + typed.length,
		crossed
	};
}

// ── One block's placement of what is typed ──────────────────────────────────

export interface TypedPlacementDeps {
	getEl: () => HTMLElement | null;
	/** The block, whose displayed text an insertion goes into. */
	getNode: () => NodeView;
	reading: Reading;
	caretMemory: Pick<CaretMemory, 'side'>;
	/** The block's held space (`caret/held-space.ts`), read lazily: the block makes it later. */
	heldSpace: () => HeldSpaceView;
}

/** Where text typed into a block lands while its screen hides markers, for the two places that
 *  ask: the write every insertion passes, and the auto-pair, which decides at `beforeinput`. */
export interface TypedPlacement {
	/** The block's step in every insertion's write (`next-insertion.ts`). */
	insertion: PlaceInsertion;
	/** The offset a byte typed at `caret` now lands at. */
	offsetFor(caret: number, typed: string): number;
}

export function createTypedPlacement(deps: TypedPlacementDeps): TypedPlacement {
	const hidingScreen = (): VisibilityContext | null => {
		const el = deps.getEl();
		return el && revealsNoMarkers(el) ? screenVisibilityOf(el) : null;
	};
	// The tree of `text`, which is the block's own unless a held space was lifted out of it.
	const inlinesOf = (text: string): InlineNode[] => {
		const node = deps.getNode();
		const raw = withOwnEnding(node, text);
		return resolvedInlineContent(raw === node.raw ? node : { ...node, raw }, deps.reading);
	};
	return {
		insertion: (before, edit, at, side, caret) => {
			const screen = hidingScreen();
			if (!screen) return null;
			const typed = edit.text.slice(at, at + edit.text.length - before.length);
			const inlines = inlinesOf(before);
			return relocateInsertion(before, at, typed, inlines, side, screen, deps.reading, caret);
		},
		offsetFor: (caret, typed) => {
			const screen = hidingScreen();
			if (!screen) return caret;
			const node = deps.getNode();
			// The closer a held space was written past is still the caret's to type over.
			const inside = deps.heldSpace().at() === caret ? deps.heldSpace().inside() : null;
			if (inside !== null && node.raw[inside] === typed) return inside;
			const reading = deps.reading;
			const inlines = resolvedInlineContent(node, reading);
			const side = deps.caretMemory.side();
			const seat = resolveEdgeSeat(caret, inlines, side, node.raw, screen, typed, reading);
			return seat?.offset ?? caret;
		}
	};
}

/** A prose block's `beforeinput` steps for typed text: the auto-pair first, since the live range
 *  edit writes a delimiter at a collapsed caret as a lone byte. True when a step took the event. */
export function applyTypedInput(
	e: InputEvent,
	steps: { autoPair: (e: InputEvent) => boolean; rangeEdit: (e: InputEvent) => boolean }
): boolean {
	return steps.autoPair(e) || steps.rangeEdit(e);
}

/** The text a commit's reading added at `at`, or null when that reading is not a plain insertion
 *  there: a composition over a selection is a range edit, which nothing here handles. */
export function plainInsertionAt(before: string, after: string, at: number): string | null {
	const length = after.length - before.length;
	if (length <= 0 || at < 0 || at > before.length) return null;
	if (after.slice(0, at) !== before.slice(0, at)) return null;
	if (after.slice(at + length) !== before.slice(at)) return null;
	return after.slice(at, at + length);
}

/** Every raw offset the caret's screen position allows: each boundary in a stretch of abutting
 *  hidden runs, never an offset inside a run's bytes, which may exclude the caret itself. */
export function seatOffsetsAt(
	caretOffset: number,
	inlines: readonly InlineNode[],
	raw: string,
	screen: VisibilityContext,
	grammar: GrammarView
): readonly number[] {
	const runs = markerRuns(inlines, raw, screen, grammar);
	const run = runAt(caretOffset, runs);
	if (!run) return [];
	const offsets = screenPositionOffsets(run, runs);
	return getInlineConstructPolicy(run.kind)?.edgeAffinity === 'never-extend'
		? offsets.filter((offset) => outsideSpan(run, offset))
		: offsets;
}

/** The offsets a plain arrow press stops at, ascending: each boundary of the caret's position a
 *  typed byte can be written at. Fewer than two means there is no choice, so the arrow moves. */
export function edgeStops(
	caretOffset: number,
	inlines: readonly InlineNode[],
	raw: string,
	screen: VisibilityContext,
	reading: Reading
): number[] {
	const typedAt = (offset: number) =>
		typingOffset(caretOffset, inlines, { offset }, raw, screen, reading);
	return seatOffsetsAt(caretOffset, inlines, raw, screen, reading.grammar)
		.filter((offset) => typedAt(offset) === offset)
		.sort((a, b) => a - b);
}

/** The raw offset the next byte would be written at under `affinity`. */
export function typingOffset(
	caretOffset: number,
	inlines: readonly InlineNode[],
	affinity: EdgeAffinity | null,
	raw: string,
	screen: VisibilityContext,
	reading: Reading
): number {
	const edge = resolveEdgeSeat(caretOffset, inlines, affinity, raw, screen, PROBE_BYTE, reading);
	return edge?.offset ?? caretOffset;
}

/** The stop a plain arrow press moves the typing offset to, one past the current one in its
 *  direction, or null when the press moves the caret as usual (live-mode.md § 4.2). */
export function edgeStep(
	caretOffset: number,
	inlines: readonly InlineNode[],
	affinity: EdgeAffinity | null,
	raw: string,
	screen: VisibilityContext,
	reading: Reading,
	direction: 'backward' | 'forward'
): number | null {
	const stops = edgeStops(caretOffset, inlines, raw, screen, reading);
	if (stops.length < 2) return null;
	const current = typingOffset(caretOffset, inlines, affinity, raw, screen, reading);
	const ahead =
		direction === 'forward'
			? stops.filter((offset) => offset > current)
			: stops.filter((offset) => offset < current).reverse();
	return ahead[0] ?? null;
}

/** A byte stands in for whatever the user types next: a letter, which pairs with nothing, so the
 *  render's verdict is about the offset and not about the byte. */
export const PROBE_BYTE = 'a';

// ── Internal ─────────────────────────────────────────────────────────────────

interface MarkerRun {
	start: number;
	end: number;
	/** The opener's run; its near side is outside the construct, its far side inside. */
	leading: boolean;
	kind: AnyInlineKind;
	/** The construct's own bytes, which bound where a `never-extend` row admits a candidate. */
	span: ContentRange;
}

/** An arrival side, the pinned case set aside: a pin is an offset, not a side. */
type Side = Exclude<EdgeAffinity, PinnedOffset>;

function offsetForSide(run: MarkerRun, side: Side): number {
	if (side === 'near') return run.start;
	if (side === 'far') return run.end;
	return run.leading ? run.start : run.end;
}

const otherEnd = (run: MarkerRun, side: Side): number =>
	offsetForSide(run, side) === run.start ? run.end : run.start;

/** The offsets to try, best first: a pin the position still holds, the policy's side, the run's
 *  other end, the caret, then the rest of the position, nearest the policy's side first. */
function candidateOffsets(
	run: MarkerRun,
	edgeAffinity: InlineConstructPolicy['edgeAffinity'],
	affinity: EdgeAffinity | null,
	caretOffset: number,
	runs: readonly MarkerRun[]
): number[] {
	// `never-extend` lands past the construct's delimiters; a symmetric pair follows the side the
	// caret arrived from, else the near side (`docs/design/live-mode.md` § 4.2).
	const position = screenPositionOffsets(run, runs);
	// A pin is the offset an edge step chose among the ones this resolver accepts (`edgeStops`), so
	// it outranks the policy while the caret's position still holds it.
	const pinned =
		typeof affinity === 'object' && affinity !== null && position.includes(affinity.offset)
			? affinity.offset
			: null;
	const recorded = typeof affinity === 'string' ? affinity : null;
	const side: Side = edgeAffinity === 'never-extend' ? 'outside' : (recorded ?? 'near');
	const preferred = offsetForSide(run, side);
	const ranked = [
		...(pinned === null ? [] : [pinned]),
		preferred,
		otherEnd(run, side),
		caretOffset
	];
	const rest = position
		.filter((offset) => !ranked.includes(offset))
		.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred));
	const offsets = [...new Set([...ranked, ...rest])];
	return edgeAffinity === 'never-extend' ? offsets.filter((o) => outsideSpan(run, o)) : offsets;
}

/** Whether `offset` lies outside the run's whole construct, which is all a `never-extend` row
 *  allows: half a URL is not a URL, and half an escape is a literal backslash. */
const outsideSpan = (run: MarkerRun, offset: number): boolean =>
	offset <= run.span.start || offset >= run.span.end;

/** The stretch of abutting runs `run` belongs to, as the boundary offsets inside it. */
function screenPositionOffsets(run: MarkerRun, runs: readonly MarkerRun[]): number[] {
	let lo = run.start;
	let hi = run.end;
	for (let grew = true; grew;) {
		grew = false;
		for (const other of runs) {
			if (other.start > hi || other.end < lo) continue;
			if (other.start < lo) {
				lo = other.start;
				grew = true;
			}
			if (other.end > hi) {
				hi = other.end;
				grew = true;
			}
		}
	}
	const bounds = new Set([lo, hi]);
	for (const other of runs) {
		if (other.start >= lo && other.start <= hi) bounds.add(other.start);
		if (other.end >= lo && other.end <= hi) bounds.add(other.end);
	}
	return [...bounds];
}

/** The bytes the inline tree covers, which is the block's content range, read off the tree rather
 *  than passed in as a second parameter that could disagree with it. */
function contentBounds(inlines: readonly InlineNode[]): ContentRange {
	return { start: inlines[0].start, end: inlines[inlines.length - 1].end };
}

/** Every construct marker run, in pre-order. */
function markerRuns(
	inlines: readonly InlineNode[],
	raw: string,
	screen: VisibilityContext,
	grammar: GrammarView
): MarkerRun[] {
	const runs: MarkerRun[] = [];
	for (const node of inlineDescendants(inlines)) {
		const content = constructContentRange(node) ?? paintedRange(node, raw, screen, grammar);
		if (!content) continue;
		const span = { start: node.start, end: node.end };
		if (node.start < content.start) {
			runs.push({ start: node.start, end: content.start, leading: true, kind: node.kind, span });
		}
		if (content.end < node.end) {
			runs.push({ start: content.end, end: node.end, leading: false, kind: node.kind, span });
		}
	}
	return runs;
}

/** The run `offset` sits in, boundaries and interior included (a caret can be handed the middle of
 *  a doubled code fence); the last in pre-order, so the innermost construct wins. */
const runAt = (offset: number, runs: readonly MarkerRun[]): MarkerRun | null =>
	runs.reduce<MarkerRun | null>(
		(found, run) => (offset >= run.start && offset <= run.end ? run : found),
		null
	);

/** What a childless construct draws, as the outer bounds of its visible runs in the block's own
 *  mode, asked of the render (G4.33); `painted-contiguity.property` holds it contiguous. */
function paintedRange(
	node: InlineNode,
	raw: string,
	screen: VisibilityContext,
	grammar: GrammarView
): ContentRange | null {
	if (node.kind === 'text') return null;
	const painted = visibleRuns([node], raw, screen, { grammar }).filter(
		(run) => run.visible && run.text !== ''
	);
	if (painted.length === 0) return null;
	return { start: painted[0].start, end: painted[painted.length - 1].end };
}
