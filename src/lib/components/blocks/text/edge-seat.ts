/**
 * Which side of a construct's unpainted marker run a typed byte belongs to: a run painted at zero
 * width leaves one screen position naming two raw offsets. The kind's `edgeAffinity` policy
 * answers first (a link never extends), the arrival affinity second.
 */

import type { AnyInlineKind, InlineNode } from '../../../core/nodes';
import type { EdgeAffinity } from '../../../cursor/edge-affinity';
import { constructContentRange } from '../../../core/inline';
import { visibleRuns, type VisibilityContext } from '../../../core/inline/visibility';
import type { ContentRange } from '../../../core/inline';
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
	affinity: EdgeAffinity | null,
	raw: string,
	screen: VisibilityContext
): EdgeSeat | null {
	const run = markerRunAt(caretOffset, inlines, raw, screen);
	if (!run) return null;
	const policy = getInlineConstructPolicy(run.kind);
	if (!policy) return null;
	// Never-extend resolves like a line extreme: past the construct's delimiters, which is the
	// run's near side at an opener and its far side at a closer. A symmetric pair follows the
	// arrival, defaulting to the near side — the gdocs click default (live-mode.md § 4.2).
	const side: EdgeAffinity =
		policy.edgeAffinity === 'never-extend' ? 'outside' : (affinity ?? 'near');
	const offset = offsetForSide(run, side);
	// The walk's read and Chromium's insertion canonicalize the same way, so `seat === caret`
	// means native typing already lands where the seat wants it.
	return offset === caretOffset ? null : { offset, kind: run.kind };
}

/**
 * The bytes a COMPOSITION commit should have written. `insertCompositionText` beforeinput is not
 * cancelable, so the seat cannot intercept the keystroke and relocates the composed run once, on
 * the commit that lands it. Null leaves the read as-is.
 */
export function relocateComposedRun(
	before: string,
	after: string,
	composedAt: number,
	inlines: readonly InlineNode[],
	affinity: EdgeAffinity | null,
	screen: VisibilityContext
): { raw: string; caret: number } | null {
	const composed = plainInsertionAt(before, after, composedAt);
	if (composed === null) return null;
	const seat = resolveEdgeSeat(composedAt, inlines, affinity, before, screen);
	if (!seat) return null;
	return {
		raw: before.slice(0, seat.offset) + composed + before.slice(seat.offset),
		caret: seat.offset + composed.length
	};
}

/** The text a commit's read added at `at`, or null when the read is not a plain insertion
 *  there — a composition over a selection is a range op, and no seat claims a range. */
export function plainInsertionAt(before: string, after: string, at: number): string | null {
	const length = after.length - before.length;
	if (length <= 0 || at < 0 || at > before.length) return null;
	if (after.slice(0, at) !== before.slice(0, at)) return null;
	if (after.slice(at + length) !== before.slice(at)) return null;
	return after.slice(at, at + length);
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

/**
 * The innermost construct marker run `offset` sits in, its own boundaries included. INSIDE counts,
 * not just the two ends — a doubled code fence is a run a caret can be handed the middle of.
 */
function markerRunAt(
	offset: number,
	inlines: readonly InlineNode[],
	raw: string,
	screen: VisibilityContext
): MarkerRun | null {
	let found: MarkerRun | null = null;
	const visit = (nodes: readonly InlineNode[]): void => {
		for (const node of nodes) {
			const content = constructContentRange(node) ?? paintedRange(node, raw, screen);
			if (content) {
				if (node.start < content.start && offset >= node.start && offset <= content.start) {
					found = { start: node.start, end: content.start, leading: true, kind: node.kind };
				} else if (content.end < node.end && offset >= content.end && offset <= node.end) {
					found = { start: content.end, end: node.end, leading: false, kind: node.kind };
				}
			}
			if (node.children) visit(node.children);
		}
	};
	visit(inlines);
	return found;
}

/**
 * What a CHILDLESS construct paints, as a range in the block's own bytes. Asked of the render path
 * rather than derived per kind: which bytes a construct shows only the painter answers (G4.33).
 * The block's OWN reading, not the content one: where its chrome paints, the whole construct is on
 * screen, no run is hidden, and the seat has nothing to relocate.
 */
function paintedRange(
	node: InlineNode,
	raw: string,
	screen: VisibilityContext
): ContentRange | null {
	if (node.kind === 'text') return null;
	const painted = visibleRuns([node], raw, screen).filter((run) => run.visible && run.text !== '');
	if (painted.length === 0) return null;
	return { start: painted[0].start, end: painted[painted.length - 1].end };
}
