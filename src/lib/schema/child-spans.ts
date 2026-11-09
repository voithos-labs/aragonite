/**
 * The joined-body container rebuild (list, table) and each child's byte span in its container's
 * `raw`, so a keystroke rewrites one region instead of every child; the line-prefixed rebuild
 * (`strip-rebuild.ts`) splices through the same spans. A span left stale fails the region check and
 * falls back to the full rebuild; a `Uint32Array` because Svelte proxies plain arrays.
 */

import { assertInvariant, devChecksOn } from '@voithos-labs/aragonite/dev-checks';
import { makeBlockNode, type CstNode } from '../core/nodes';
import { perfEnabled, recordJoinedChildReads } from '../perf/instruments';
import { isBlankText } from '../core/lines';

/** The child a rebuild is re-rendering, and the bytes its region currently holds. */
export interface ChildRawChange {
	index: number;
	previousRaw: string;
}

/** The space a container's marker lacks, written into its own bytes at `at`, the start of the
 *  child behind the marker; the next rebuild keeps the line as written. */
export function writeMarkerSpace(container: CstNode, at: number): void {
	container.raw = container.raw.slice(0, at) + ' ' + container.raw.slice(at);
	dropChildSpans(container);
}

/** The child whose span holds byte `at` of its container's, or -1 for a byte between children (a
 *  table's delimiter line, a quote's trailing blank lines). */
export function spanHolding(spans: Uint32Array, at: number): number {
	let lo = 0;
	let hi = spans.length / 2 - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (spans[mid * 2] <= at) lo = mid;
		else hi = mid - 1;
	}
	return spans[lo * 2] <= at && at < spans[lo * 2 + 1] ? lo : -1;
}

/** Drop the spans a change to the children invalidated; the next full rebuild recomputes them. */
export function dropChildSpans(node: CstNode): void {
	// Checked before writing: an unconditional write would add the field to every node passed in.
	if (node.childSpans) node.childSpans = undefined;
}

// ── Rebuilds ─────────────────────────────────────────────────────────────────

/** A container whose raw is its children's bytes joined (list); true when only the changed
 *  child's region was rewritten. `joined` sees each child a full rebuild joins, in that pass. */
export function rebuildConcatRaw(
	node: CstNode,
	changed?: ChildRawChange,
	joined?: (child: CstNode) => void
): boolean {
	const children = node.children!;
	if (changed && spliceVerbatimChild(node, changed, rebuildConcatRaw)) return true;

	recordJoinedChildReads(children.length);
	const spans = new Uint32Array(children.length * 2);
	let out = '';
	for (let i = 0; i < children.length; i++) {
		// One indexed read per child: the array is a `$state` proxy, so every read is a proxy trap.
		const child = children[i];
		spans[i * 2] = out.length;
		out += child.leadingTrivia + child.raw;
		spans[i * 2 + 1] = out.length;
		joined?.(child);
	}
	node.raw = out;
	node.childSpans = spans;
	return false;
}

/**
 * For a container whose raw holds each child's bytes as they are (a list's items, a table's rows):
 * rewrites the changed child's region in place, or returns false for the caller's full rebuild.
 */
export function spliceVerbatimChild(
	node: CstNode,
	changed: ChildRawChange,
	rebuildFull: (scratch: CstNode) => void
): boolean {
	const rewrite: RegionRewrite = (region, { trivia, child }) =>
		region === trivia + changed.previousRaw ? trivia + child.raw : null;
	return spliceChildRegion(node, changed, rewrite) && spliceIsFaithful(node, rebuildFull);
}

// ── The splice ───────────────────────────────────────────────────────────────

export interface RegionAt {
	trivia: string;
	child: CstNode;
	first: boolean;
	tailIsBlank: () => boolean;
}

/** The child's new region written over its current one, or null when the region doesn't hold
 *  the child's previous bytes. */
export type RegionRewrite = (region: string, at: RegionAt) => string | null;

/**
 * A dev-only comparison with a full rebuild on a scratch node, so a sibling's bytes moving under the
 * spans cannot reach the document (G1.38). Skipped under the perf instruments, which would time it.
 */
export function spliceIsFaithful(node: CstNode, rebuildFull: (scratch: CstNode) => void): boolean {
	if (!devChecksOn || perfEnabled()) return true;
	const scratch = makeBlockNode({
		kind: node.kind,
		leadingTrivia: node.leadingTrivia,
		raw: node.raw,
		metadata: node.metadata,
		children: node.children,
		innerPrefix: node.innerPrefix,
		innerSuffix: node.innerSuffix
	});
	rebuildFull(scratch);
	if (scratch.raw === node.raw) return true;
	assertInvariant('child-spans-faithful', () => ({
		code: 'child-spans-faithful',
		message: `${node.kind}: the spliced raw differs from a full rebuild of the same children`,
		detail: { kind: node.kind }
	}));
	return false;
}

/**
 * Rewrite one child's region in place, or decline so the caller rebuilds from scratch: a span that
 * stopped describing `raw` costs a slower rebuild, never corrupted bytes.
 */
export function spliceChildRegion(
	node: CstNode,
	changed: ChildRawChange,
	rewrite: RegionRewrite
): boolean {
	const children = node.children!;
	const spans = node.childSpans;
	if (!spans || spans.length !== children.length * 2) return false;

	const child = children[changed.index];
	if (!child) return false;
	const start = spans[changed.index * 2];
	const end = spans[changed.index * 2 + 1];
	const raw = node.raw;
	if (start > end || end > raw.length) return false;

	// A child turning blank, or back, decides whether the empty blocks before it end the body.
	if (isBlankText(changed.previousRaw) !== isBlankText(child.raw)) return false;
	const tailIsBlank = () =>
		isBlankText(node.innerSuffix ?? '') &&
		children
			.slice(changed.index + 1)
			.every((later) => isBlankText(later.leadingTrivia + later.raw));
	const first = start === 0;
	const rendered = rewrite(raw.slice(start, end), {
		trivia: child.leadingTrivia,
		child,
		first,
		tailIsBlank
	});
	if (rendered === null) return false;
	if (end < raw.length) {
		// Nothing may run into the regions that follow: a child not ending in a line ending would
		// share its last line, and an emptied first region hands line 0 to the next child.
		if (rendered !== '' && !rendered.endsWith('\n')) return false;
		if (first && end > start !== (rendered !== '')) return false;
	}

	node.raw = raw.slice(0, start) + rendered + raw.slice(end);
	const delta = rendered.length - (end - start);
	if (delta !== 0) {
		spans[changed.index * 2 + 1] = end + delta;
		for (let i = changed.index * 2 + 2; i < spans.length; i++) spans[i] += delta;
	}
	return true;
}
