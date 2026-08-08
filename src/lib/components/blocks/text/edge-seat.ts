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
 * marker run, the kind declares no policy, or the seat is already where the caret is — the
 * cases native insertion gets right on its own.
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
	// Never-extend means outside the CONSTRUCT, which is the run's near side at a leading run
	// and its far side at a trailing one. A symmetric pair follows the arrival, defaulting to
	// the near side — where an unclaimed caret already sits.
	const side: EdgeAffinity =
		policy.edgeAffinity === 'never-extend'
			? run.leading
				? 'inside'
				: 'outside'
			: (affinity ?? 'inside');
	const offset = side === 'inside' ? run.start : run.end;
	return offset === caretOffset ? null : { offset, kind: run.kind };
}

// ── Internal ─────────────────────────────────────────────────────────────────

interface MarkerRun {
	start: number;
	end: number;
	/** The opener's run; its near side is outside the construct, its far side inside. */
	leading: boolean;
	kind: AnyInlineKind;
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
