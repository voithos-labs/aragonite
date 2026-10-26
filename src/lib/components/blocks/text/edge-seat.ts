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
import {
	insertedText,
	type InsertionPlacement,
	type PlacedEdit
} from '../../../caret/next-insertion';
import type { HeldSpaceView } from '../../../caret/held-space';
import type { InsideCloserView } from '../../../caret/inside-closer';
import type { NodeView } from '../../../core/node-views';
import { resolvedInlineContent } from '../../../core/inline/inline-cache';
import { withOwnEnding } from '../editable/surface-write';
import { hidingScreenOf } from '../../../browser/painted';
import { resolveMarkedInsertion } from './pending-mark-insert';
import { recordMarkerRunRead } from '../../../perf/instruments';

/** One block's hidden marker runs on one screen, read once for every edge question a key press
 *  asks. `reading` must be the one `inlines` was read with, or a reference link reads as brackets. */
export interface HiddenEdges {
	/** Every raw offset the caret's screen position allows: each boundary in a stretch of abutting
	 *  hidden runs, never an offset inside a run's bytes, which may exclude the caret itself. */
	seatOffsets(caret: number): readonly number[];
	/** The raw offset `typed` is written at with `record` on the caret memory: the caret itself
	 *  where no hidden edge moves it. */
	typingOffset(caret: number, record: EdgeAffinity | null, typed?: string): number;
	/** The two stops of the painted box whose border the caret sits at, by side, or null where the
	 *  caret is at no such border or a stop doesn't take a typed letter. */
	chipStops(caret: number): { inside: number; outside: number } | null;
	/** The stop a plain arrow press moves the typing offset to, one past the current one in its
	 *  direction, or null when the press moves the caret as usual. */
	edgeStep(
		caret: number,
		record: EdgeAffinity | null,
		direction: 'backward' | 'forward'
	): number | null;
	/** The offset a closer byte typed at `caret` types over: the first byte equal to `typed` in the
	 *  hidden closer of a mark at the caret's screen position, from either raw offset of it. */
	closerByteAt(caret: number, typed: string): number | null;
	/** `typed`, inserted at `at`, written where the edge rule puts it, or null where it already
	 *  lands there. `caret` counts only where it names the same screen position as `at`. */
	relocate(
		at: number,
		typed: string,
		record: EdgeAffinity | null,
		caret?: number
	): PlacedEdit | null;
}

export function hiddenEdges(
	inlines: readonly InlineNode[],
	raw: string,
	screen: VisibilityContext,
	reading: Reading
): HiddenEdges {
	const { grammar } = reading;
	const runs = markerRuns(inlines, raw, screen, grammar);
	const positionAt = (caret: number): ScreenPosition | null => {
		const run = runAt(caret, runs);
		return run && screenPosition(run, runs);
	};
	const seatOffsets = (caret: number): readonly number[] => {
		const position = positionAt(caret);
		return position ? position.offsets.filter((at) => takesNothingInside(position, at)) : [];
	};
	let shownBefore: string | null = null;

	/** The offset the edge rule writes `typed` at, which may be the caret's own; null where the
	 *  caret is at no hidden edge or no offset there keeps the screen. */
	function seat(caret: number, record: EdgeAffinity | null, typed: string): number | null {
		const run = runAt(caret, runs);
		if (!run || !getInlineConstructPolicy(run.kind)) return null;
		const content = contentBounds(inlines);
		// What the user sees, asked of the renderer (G4.33), in the content reading: a placement
		// only adds bytes, so no reading of it can license dropping one.
		const shown = (bytes: string, end: number): string =>
			renderedText(
				readInline(bytes, content.start, end, reading.resolver, grammar),
				bytes,
				CONTENT_VISIBILITY,
				{ grammar }
			);
		const before = (shownBefore ??= shown(raw, content.end));
		const holds = (offset: number): boolean => {
			const candidate = raw.slice(0, offset) + typed + raw.slice(offset);
			return insertsExactly(before, shown(candidate, content.end + typed.length), typed);
		};
		const position = screenPosition(run, runs);
		return candidateOffsets(position, record, caret, raw, inlines).find(holds) ?? null;
	}
	const typingOffset = (caret: number, record: EdgeAffinity | null, typed = PROBE_BYTE): number =>
		seat(caret, record, typed) ?? caret;

	function chipStops(caret: number): { inside: number; outside: number } | null {
		const boxed = positionAt(caret)?.runs.find(
			(each) => getInlineConstructPolicy(each.kind)?.edgeAffinity === 'boxed'
		);
		if (!boxed) return null;
		const stops = boxed.leading
			? { inside: boxed.end, outside: boxed.start }
			: { inside: boxed.start, outside: boxed.end };
		const typedAt = (offset: number) => typingOffset(caret, { offset });
		return typedAt(stops.inside) === stops.inside && typedAt(stops.outside) === stops.outside
			? stops
			: null;
	}

	return {
		seatOffsets,
		typingOffset,
		chipStops,
		edgeStep: (caret, record, direction) => {
			const stops = chipStops(caret);
			if (!stops) return null;
			const current = typingOffset(caret, record);
			const ordered = [stops.inside, stops.outside].sort((a, b) => a - b);
			const ahead =
				direction === 'forward'
					? ordered.filter((offset) => offset > current)
					: ordered.filter((offset) => offset < current).reverse();
			return ahead[0] ?? null;
		},
		closerByteAt: (caret, typed) => {
			for (const each of positionAt(caret)?.runs ?? []) {
				if (each.leading || !getInlineMarkPolicy(each.kind)) continue;
				for (let at = each.start; at < each.end; at++) if (raw[at] === typed) return at;
			}
			return null;
		},
		relocate: (at, typed, record, caret = at) => {
			const samePosition = caret === at || seatOffsets(at).includes(caret);
			const offset = seat(samePosition ? caret : at, record, typed);
			if (offset === null || offset === at) return null;
			const lo = Math.min(offset, at);
			const hi = Math.max(offset, at);
			const crossed = [...inlineDescendants(inlines)].flatMap((node) => {
				const content = constructContentRange(node);
				const edge = (each: number) => each >= lo && each <= hi;
				return content && (edge(content.start) || edge(content.end)) ? [node.kind] : [];
			});
			return {
				text: raw.slice(0, offset) + typed + raw.slice(offset),
				caretAfter: offset + typed.length,
				crossed
			};
		}
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
	/** The caret Edit link left before a hidden closer (`caret/inside-closer.ts`), read lazily too. */
	insideCloser: () => InsideCloserView;
}

/** Where text typed into a block lands while its screen hides markers, and how a pending mark wraps
 *  it: the step every insertion's write passes, and the read for the places that decide earlier. */
export interface TypedPlacement {
	/** The block's step in every insertion's write (`next-insertion.ts`). */
	insertion: InsertionPlacement;
	/** The offset a byte typed at `caret` now lands at, for the auto-pair, which decides at
	 *  `beforeinput`. */
	offsetFor(caret: number, typed: string): number;
	/** A byte of a hidden closer was typed over at `from`, leaving `to`: the next letter types
	 *  outside the construct, unless a held space waits for the rest of that closer. */
	passCloser(from: number, to: number): void;
}

export function createTypedPlacement(deps: TypedPlacementDeps): TypedPlacement {
	// The tree of `text`, which is the block's own unless a held space was lifted out of it.
	const inlinesOf = (text: string): InlineNode[] => {
		const node = deps.getNode();
		const raw = withOwnEnding(node, text);
		return resolvedInlineContent(raw === node.raw ? node : { ...node, raw }, deps.reading);
	};
	return {
		insertion: {
			place: (before, edit, at, side, caret) => {
				const screen = hidingScreenOf(deps.getEl());
				if (!screen) return null;
				const edges = hiddenEdges(inlinesOf(before), before, screen, deps.reading);
				return edges.relocate(at, insertedText(before, edit, at), side, caret);
			},
			mark: (before, edit, at, marks, side) => {
				const screen = hidingScreenOf(deps.getEl());
				if (!screen) return null;
				const inlines = inlinesOf(before);
				// The marks apply where a letter would land, which Edit link's caret keeps inside the URL.
				const seat =
					deps.insideCloser().at() === at
						? at
						: hiddenEdges(inlines, before, screen, deps.reading).typingOffset(at, side);
				const typed = insertedText(before, edit, at);
				const marked = resolveMarkedInsertion(before, seat, typed, marks, inlines, deps.reading);
				return marked && { text: marked.raw, caretAfter: marked.caret };
			}
		},
		offsetFor: (caret, typed) => {
			const screen = hidingScreenOf(deps.getEl());
			if (!screen) return caret;
			// Edit link's caret types inside the URL, which no edge rule would choose.
			if (deps.insideCloser().at() === caret) return caret;
			const node = deps.getNode();
			// The closer a held space was written past is still the caret's to type over.
			const inside = deps.heldSpace().at() === caret ? deps.heldSpace().inside() : null;
			if (inside !== null && node.raw[inside] === typed) return inside;
			const inlines = resolvedInlineContent(node, deps.reading);
			const edges = hiddenEdges(inlines, node.raw, screen, deps.reading);
			return (
				edges.closerByteAt(caret, typed) ??
				edges.typingOffset(caret, deps.caretMemory.side(), typed)
			);
		},
		passCloser: (from, to) => {
			const held = deps.heldSpace();
			const raw = deps.getNode().raw;
			if (held.inside() === from && raw[to] === raw[from]) held.passCloser(to);
			else deps.caretMemory.noteOutside();
		}
	};
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

// ── Internal ─────────────────────────────────────────────────────────────────

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
	recordMarkerRunRead();
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
