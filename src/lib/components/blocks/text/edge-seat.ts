/**
 * Which side of a construct's unpainted marker run a typed byte belongs to. A mode that
 * reveals no marker paints the run at zero width, so one screen position names two raw
 * offsets; the kind's `edgeAffinity` policy answers first (a link never extends), the
 * arrival affinity second. Pure over the inline tree: offsets in, one offset out.
 */

import type { AnyInlineKind, InlineNode } from '../../../core/nodes';
import type { EdgeAffinity } from '../../../cursor/edge-affinity';
import { getInlineConstructPolicy } from '../../../schema/inline-construct-policy';

export interface EdgeSeat {
	/** Raw offset the byte must be written at. */
	offset: number;
	kind: AnyInlineKind;
}

/**
 * Where a byte typed at `caretOffset` belongs, or null when the offset touches no construct
 * marker run, the kind declares no policy, or the seat is already where the caret is.
 */
export function resolveEdgeSeat(
	caretOffset: number,
	inlines: readonly InlineNode[],
	affinity: EdgeAffinity | null
): EdgeSeat | null {
	const run = markerRunAt(caretOffset, inlines);
	if (!run) return null;
	const policy = getInlineConstructPolicy(run.kind);
	if (!policy) return null;
	// Never-extend resolves like a line extreme: past the construct's delimiters, which is the
	// run's near side at an opener and its far side at a closer. A symmetric pair follows the
	// arrival, defaulting to the near side — the gdocs click default (§ 4.2).
	const side: EdgeAffinity =
		policy.edgeAffinity === 'never-extend' ? 'outside' : (affinity ?? 'near');
	const offset = offsetForSide(run, side);
	// Declining when the seat is already the caret is sound only because a read at a hidden
	// run's pixel always canonicalizes to the run's near side: the browser has seated the
	// insertion there, so "seat === caret" means native typing already lands right.
	return offset === caretOffset ? null : { offset, kind: run.kind };
}

/**
 * The bytes a COMPOSITION commit should have written. An IME inserts at the DOM caret and its
 * `insertCompositionText` beforeinput is not cancelable, so the seat cannot intercept the
 * keystroke — it relocates the composed run once, here, on the same commit that lands it.
 * Null leaves the read as-is: no seat, or bytes that are not a plain insertion at `composedAt`
 * (a composition over a selection is a range op, and the seat claims no range).
 */
export function relocateComposedRun(
	before: string,
	after: string,
	composedAt: number,
	inlines: readonly InlineNode[],
	affinity: EdgeAffinity | null
): { raw: string; caret: number } | null {
	const length = after.length - before.length;
	if (length <= 0 || composedAt < 0 || composedAt > before.length) return null;
	if (after.slice(0, composedAt) !== before.slice(0, composedAt)) return null;
	if (after.slice(composedAt + length) !== before.slice(composedAt)) return null;
	const seat = resolveEdgeSeat(composedAt, inlines, affinity);
	if (!seat) return null;
	const composed = after.slice(composedAt, composedAt + length);
	return {
		raw: before.slice(0, seat.offset) + composed + before.slice(seat.offset),
		caret: seat.offset + length
	};
}

// ── Composition seat ─────────────────────────────────────────────────────────

export interface CompositionSeatDeps {
	/** The block's display bytes — what a commit's read is compared against. */
	getDisplayText: () => string;
	getInlines: () => readonly InlineNode[];
	getAffinity: () => EdgeAffinity | null;
}

export interface CompositionSeat {
	/** Capture the arrival and the bytes the composition begins from. Call BEFORE the surface's
	 *  own `compositionstart`, whose cross-block half clears the affinity, and before the first
	 *  mid-composition `input`, which re-arms it to the typed side. */
	noteStart(): void;
	/** The bytes the commit should write, or null to keep the DOM read verbatim. */
	relocate(after: string, composedAt: number): { raw: string; caret: number } | null;
	noteEnd(): void;
}

/** One composition's worth of seat inputs. The window is compositionstart → the commit that
 *  compositionend drives, so the state is a single nullable capture rather than a stack. */
export function createCompositionSeat(deps: CompositionSeatDeps): CompositionSeat {
	let started: { before: string; affinity: EdgeAffinity | null } | null = null;
	return {
		noteStart: () => {
			started = { before: deps.getDisplayText(), affinity: deps.getAffinity() };
		},
		relocate: (after, composedAt) =>
			started === null
				? null
				: relocateComposedRun(
						started.before,
						after,
						composedAt,
						deps.getInlines(),
						started.affinity
					),
		noteEnd: () => {
			started = null;
		}
	};
}

// ── Internal ─────────────────────────────────────────────────────────────────

interface MarkerRun {
	start: number;
	end: number;
	/** The opener's run; its near side is outside the construct, its far side inside. */
	leading: boolean;
	kind: AnyInlineKind;
}

function offsetForSide(run: MarkerRun, side: EdgeAffinity): number {
	if (side === 'near') return run.start;
	if (side === 'far') return run.end;
	return run.leading ? run.start : run.end;
}

/** The innermost construct marker run either of whose boundaries `offset` names. Innermost
 *  wins: children are visited after their parent, so a nested pair claims its own edge. */
function markerRunAt(offset: number, inlines: readonly InlineNode[]): MarkerRun | null {
	let found: MarkerRun | null = null;
	const visit = (nodes: readonly InlineNode[]): void => {
		for (const node of nodes) {
			const content = contentRangeOf(node);
			if (content) {
				if (node.start < content.start && (offset === node.start || offset === content.start)) {
					found = { start: node.start, end: content.start, leading: true, kind: node.kind };
				} else if (content.end < node.end && (offset === content.end || offset === node.end)) {
					found = { start: content.end, end: node.end, leading: false, kind: node.kind };
				}
			}
			if (node.children) visit(node.children);
		}
	};
	visit(inlines);
	return found;
}

/** The bytes a construct's delimiters do not cover, or null for a kind that has none —
 *  a bare text run, or a pair emptied of content. */
function contentRangeOf(node: InlineNode): { start: number; end: number } | null {
	const children = node.children;
	if (children && children.length > 0) {
		return { start: children[0].start, end: children[children.length - 1].end };
	}
	// A code span carries its content as `text` rather than children, and a matched span's two
	// backtick runs are equal, so what the content does not cover splits evenly between them.
	if (node.kind === 'inlineCode' && node.text !== undefined) {
		const fence = (node.end - node.start - node.text.length) / 2;
		if (Number.isInteger(fence) && fence > 0) {
			return { start: node.start + fence, end: node.end - fence };
		}
	}
	return null;
}
