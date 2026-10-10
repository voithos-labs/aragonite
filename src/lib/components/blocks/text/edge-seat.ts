/**
 * Where a byte typed at a construct's hidden edge goes: a marker run drawn at zero width leaves one
 * screen position standing for several raw offsets. The letter joins what the visible character
 * before the position is in (at a line start, the one after) unless the caret memory's record says
 * otherwise; a `never-extend` kind takes nothing at its edge, and the render has the last word
 * (live-mode.md § 2), since a position that reads right can parse wrong.
 */

import type { AnyInlineKind, InlineNode } from '../../../core/nodes';
import type { EdgeAffinity } from '../../../caret/edge-affinity';
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
	getInlineMarkPolicy
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
	record: EdgeAffinity | null,
	raw: string,
	screen: VisibilityContext,
	typed: string,
	reading: Reading
): EdgeSeat | null {
	const seat = seatAt(caretOffset, inlines, record, raw, screen, typed, reading);
	// The DOM-to-offset traversal and Chromium's insertion normalise the same way, so an answer
	// equal to the caret means ordinary typing already lands there.
	return seat && seat.offset !== caretOffset ? seat : null;
}

/** `typed`, inserted at `at` in `before`, written where the edge resolver puts it, or null where
 *  it already lands there. `caret` counts only where it names the same screen position as `at`. */
export function relocateInsertion(
	before: string,
	at: number,
	typed: string,
	inlines: readonly InlineNode[],
	record: EdgeAffinity | null,
	screen: VisibilityContext,
	reading: Reading,
	caret = at
): PlacedEdit | null {
	const samePosition =
		caret === at || seatOffsetsAt(at, inlines, before, screen, reading.grammar).includes(caret);
	const from = samePosition ? caret : at;
	const seat = seatAt(from, inlines, record, before, screen, typed, reading);
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
	caretMemory: Pick<CaretMemory, 'side' | 'noteOutside'>;
	/** The block's held space (`caret/held-space.ts`), read lazily: the block makes it later. */
	heldSpace: () => HeldSpaceView;
}

/** Where text typed into a block lands while its screen hides markers: the step every insertion's
 *  write passes, and the read for the places that decide before the write. */
export interface TypedPlacement {
	/** The block's step in every insertion's write (`next-insertion.ts`). */
	insertion: PlaceInsertion;
	/** The offset a byte typed at `caret` now lands at: the one read the auto-pair, the chord's
	 *  pending marks, the composition and the caret's look share. */
	offsetFor(caret: number, typed: string): number;
	/** A byte of a hidden closer was typed over at `from`, leaving `to`: the next letter types
	 *  outside the construct, unless a held space waits for the rest of that closer. */
	passCloser(from: number, to: number): void;
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
			const over = closerByteAt(caret, inlines, node.raw, screen, reading.grammar, typed);
			if (over !== null) return over;
			const record = deps.caretMemory.side();
			const seat = resolveEdgeSeat(caret, inlines, record, node.raw, screen, typed, reading);
			return seat?.offset ?? caret;
		},
		passCloser: (from, to) => {
			const held = deps.heldSpace();
			const raw = deps.getNode().raw;
			if (held.inside() === from && raw[to] === raw[from]) held.passCloser(to);
			else deps.caretMemory.noteOutside();
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
	const position = screenPosition(run, runs);
	return position.offsets.filter((offset) => takesNothingInside(position, offset));
}

/** The offsets a plain arrow press stops at, ascending: the two sides of a painted box's border,
 *  each a visible caret position. Fewer than two means the arrow moves the caret. */
export function edgeStops(
	caretOffset: number,
	inlines: readonly InlineNode[],
	raw: string,
	screen: VisibilityContext,
	reading: Reading
): number[] {
	const stops = chipStops(caretOffset, inlines, raw, screen, reading);
	return stops ? [stops.inside, stops.outside].sort((a, b) => a - b) : [];
}

/** The two stops of the painted box whose border the caret sits at, by side, or null where the
 *  caret is at no such border or a stop doesn't take a typed letter. */
export function chipStops(
	caretOffset: number,
	inlines: readonly InlineNode[],
	raw: string,
	screen: VisibilityContext,
	reading: Reading
): { inside: number; outside: number } | null {
	const runs = markerRuns(inlines, raw, screen, reading.grammar);
	const run = runAt(caretOffset, runs);
	if (!run) return null;
	const boxed = screenPosition(run, runs).runs.find(
		(each) => getInlineConstructPolicy(each.kind)?.edgeAffinity === 'boxed'
	);
	if (!boxed) return null;
	const stops = boxed.leading
		? { inside: boxed.end, outside: boxed.start }
		: { inside: boxed.start, outside: boxed.end };
	const typedAt = (offset: number) =>
		typingOffset(caretOffset, inlines, { offset }, raw, screen, reading);
	return typedAt(stops.inside) === stops.inside && typedAt(stops.outside) === stops.outside
		? stops
		: null;
}

/** The raw offset the next byte would be written at with `record` on the caret memory. */
export function typingOffset(
	caretOffset: number,
	inlines: readonly InlineNode[],
	record: EdgeAffinity | null,
	raw: string,
	screen: VisibilityContext,
	reading: Reading
): number {
	const edge = resolveEdgeSeat(caretOffset, inlines, record, raw, screen, PROBE_BYTE, reading);
	return edge?.offset ?? caretOffset;
}

/** The stop a plain arrow press moves the typing offset to, one past the current one in its
 *  direction, or null when the press moves the caret as usual. */
export function edgeStep(
	caretOffset: number,
	inlines: readonly InlineNode[],
	record: EdgeAffinity | null,
	raw: string,
	screen: VisibilityContext,
	reading: Reading,
	direction: 'backward' | 'forward'
): number | null {
	const stops = edgeStops(caretOffset, inlines, raw, screen, reading);
	if (stops.length < 2) return null;
	const current = typingOffset(caretOffset, inlines, record, raw, screen, reading);
	const ahead =
		direction === 'forward'
			? stops.filter((offset) => offset > current)
			: stops.filter((offset) => offset < current).reverse();
	return ahead[0] ?? null;
}

/** A byte stands in for whatever the user types next: a letter, which pairs with nothing, so the
 *  render's verdict is about the offset and not about the byte. */
export const PROBE_BYTE = 'a';

/** The constructs whose content holds the character at `at`, outermost first: the chain a letter
 *  there belongs to, which a letter typed beside it joins. */
export function constructsCovering(inlines: readonly InlineNode[], at: number): InlineNode[] {
	const chain: InlineNode[] = [];
	for (let level: readonly InlineNode[] | undefined = inlines; level;) {
		const holder: InlineNode | undefined = level.find((node) => {
			if (node.kind === 'text') return false;
			const content = constructContentRange(node) ?? node;
			return content.start <= at && at < content.end;
		});
		if (!holder) break;
		chain.push(holder);
		level = holder.children;
	}
	return chain;
}

/** The offset a closer byte typed at `caret` types over: the first byte equal to `typed` in the
 *  hidden closer of a mark at the caret's screen position, from either raw offset of it. */
export function closerByteAt(
	caret: number,
	inlines: readonly InlineNode[],
	raw: string,
	screen: VisibilityContext,
	grammar: GrammarView,
	typed: string
): number | null {
	const runs = markerRuns(inlines, raw, screen, grammar);
	const run = runAt(caret, runs);
	if (!run) return null;
	for (const each of screenPosition(run, runs).runs) {
		if (each.leading || !getInlineMarkPolicy(each.kind)) continue;
		for (let at = each.start; at < each.end; at++) if (raw[at] === typed) return at;
	}
	return null;
}

// ── Internal ─────────────────────────────────────────────────────────────────

/** The offset the edge rule writes `typed` at for a caret at `caretOffset`, which may be the caret's
 *  own; null where the caret is at no hidden edge or no offset there keeps the screen. */
function seatAt(
	caretOffset: number,
	inlines: readonly InlineNode[],
	record: EdgeAffinity | null,
	raw: string,
	screen: VisibilityContext,
	typed: string,
	reading: Reading
): EdgeSeat | null {
	const { grammar } = reading;
	const runs = markerRuns(inlines, raw, screen, grammar);
	const run = runAt(caretOffset, runs);
	if (!run || !getInlineConstructPolicy(run.kind)) return null;
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
	const position = screenPosition(run, runs);
	const offset = candidateOffsets(position, record, caretOffset, raw, inlines).find(holds);
	return offset === undefined ? null : { offset, kind: run.kind };
}

interface MarkerRun {
	start: number;
	end: number;
	/** The opener's run; its near side is outside the construct, its far side inside. */
	leading: boolean;
	kind: AnyInlineKind;
	node: InlineNode;
	/** The construct's own bytes, which bound where a `never-extend` row admits a candidate. */
	span: ContentRange;
	/** What the construct shows; a letter typed from its start to its end joins it. */
	content: ContentRange;
}

/** One screen position: its boundary offsets ascending, and the runs that meet there. */
interface ScreenPosition {
	offsets: number[];
	runs: MarkerRun[];
}

/** The offsets to try, best first: a chip stop the position holds, the offset the record or the
 *  character beside the position names, the rest nearest it, then the caret; none in a never-extend. */
function candidateOffsets(
	position: ScreenPosition,
	record: EdgeAffinity | null,
	caretOffset: number,
	raw: string,
	inlines: readonly InlineNode[]
): number[] {
	const pinned =
		typeof record === 'object' && record !== null && position.offsets.includes(record.offset)
			? record.offset
			: null;
	const preferred =
		record === 'outside' ? outsideOffset(position) : neighbourOffset(position, raw, inlines);
	const ranked = [...(pinned === null ? [] : [pinned]), preferred];
	// Nearest the preferred offset, never by the caret's own, so every raw offset of the position
	// falls back alike; the caret comes last for an offset inside a run, which no boundary lists.
	const rest = position.offsets
		.filter((offset) => !ranked.includes(offset))
		.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred));
	return [...new Set([...ranked, ...rest, caretOffset])].filter((offset) =>
		takesNothingInside(position, offset)
	);
}

/** The offset where a letter joins exactly the constructs, of those meeting here, that the visible
 *  character beside the position is in: the one before it, or at a line start the one after. */
function neighbourOffset(
	position: ScreenPosition,
	raw: string,
	inlines: readonly InlineNode[]
): number {
	const { offsets } = position;
	const lo = offsets[0];
	const hi = offsets[offsets.length - 1];
	const lineStart = lo === contentBounds(inlines).start || raw[lo - 1] === '\n';
	const wanted = new Set(
		constructsCovering(inlines, lineStart ? hi : lo - 1).filter(
			(node) => getInlineConstructPolicy(node.kind)?.edgeAffinity !== 'never-extend'
		)
	);
	const order = lineStart ? [...offsets].reverse() : offsets;
	const found = order.find((offset) =>
		position.runs.every((run) => joins(run, offset) === wanted.has(run.node))
	);
	return found ?? (lineStart ? hi : lo);
}

/** The offset where a letter joins the fewest constructs meeting here: past every closer and
 *  before every opener. */
function outsideOffset(position: ScreenPosition): number {
	const depth = (offset: number) => position.runs.filter((run) => joins(run, offset)).length;
	return position.offsets.reduce((best, offset) => (depth(offset) < depth(best) ? offset : best));
}

/** Whether a letter typed at `offset` lands in `run`'s construct. */
const joins = (run: MarkerRun, offset: number): boolean =>
	run.content.start <= offset && offset <= run.content.end;

/** Whether `offset` lies outside every never-extend construct meeting at the position, which is all
 *  such a row allows: half a URL is not a URL, and half an escape is a literal backslash. */
const takesNothingInside = (position: ScreenPosition, offset: number): boolean =>
	position.runs.every(
		(run) =>
			getInlineConstructPolicy(run.kind)?.edgeAffinity !== 'never-extend' ||
			offset <= run.span.start ||
			offset >= run.span.end
	);

/** The stretch of abutting runs `run` belongs to: its boundary offsets, and the runs in it. */
function screenPosition(run: MarkerRun, runs: readonly MarkerRun[]): ScreenPosition {
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
	const here = runs.filter((other) => other.start >= lo && other.end <= hi);
	const bounds = new Set([lo, hi, ...here.flatMap((other) => [other.start, other.end])]);
	return { offsets: [...bounds].sort((a, b) => a - b), runs: here };
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
		const run = { kind: node.kind, node, span: { start: node.start, end: node.end }, content };
		if (node.start < content.start) {
			runs.push({ ...run, start: node.start, end: content.start, leading: true });
		}
		if (content.end < node.end) {
			runs.push({ ...run, start: content.end, end: node.end, leading: false });
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
