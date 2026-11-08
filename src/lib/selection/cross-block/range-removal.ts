/**
 * A range's removal through the range-edit core: the selection read as bytes, the core's answer
 * with every ordered list it shortened numbered on, landed as one byte splice. Every gesture that
 * removes a range the editor holds goes through here, and so does a block removed whole.
 */

import type { DocumentView } from '../../core/node-views';
import { metadataIfKind, type AnyBlockKind } from '../../core/nodes';
import { getContentRange, isProseKind } from '../../core/inline';
import { hidesDelimitersAtCaret } from '../../presentation-mode';
import { removalOf, type Range, type RemovalGesture } from '../../range-edit/edit-range';
import { rangeHost } from '../../range-edit/host';
import type { LaidBlock, Layout } from '../../range-edit/layout';
import { changesBetween } from '../../tree-operations/byte-splice';
import { blockNodeAt } from '../../tree-operations/node-primitives';
import { deleteSnapshot, type SelectionPoint } from '../primitives';
import { liveSlot } from '../caret-target';
import { firstCaretLeafFrom, previousCaretPath } from '../path-lookup';
import { pointAtByte, removalBytes } from '../range-bytes';
import type { RangeCoverage } from '../range-coverage';
import type { CrossBlockDispatchContext } from './dispatch';

export type RemovalContext = Pick<
	CrossBlockDispatchContext,
	'bytes' | 'reading' | 'controller' | 'getDoc'
>;

export interface Removed {
	wrote: boolean;
	/** Where the removal left the caret, read on the committed tree. */
	caret: SelectionPoint | null;
	/** Whether that caret sits in a block's text, rather than on a block held whole or between two. */
	inText: boolean;
}

/** Removes what `coverage` holds as `gesture` does, in one commit. */
export async function removeThroughCore(
	ctx: RemovalContext,
	coverage: RangeCoverage,
	gesture: RemovalGesture
): Promise<Removed> {
	const tree = ctx.bytes.doc();
	const layout = ctx.bytes.layout();
	const source = ctx.bytes.source();
	const range = removalBytes(tree, coverage, layout);
	if (!range) return { wrote: false, caret: null, inText: false };
	const mode = hidesDelimitersAtCaret(ctx.reading.mode()) ? 'live' : 'source';
	const host = rangeHost(ctx.reading, { source, tree, layout });
	const answer = removalOf(source, range, gesture, mode, host);
	const { start } = coverage.range;
	const wrote = await ctx.controller.commitSource({
		changes: changesBetween(source, numberedOn(tree, layout, source, range, answer.source)),
		caret: answer.caret,
		op: { kind: 'delete', detail: { crossBlock: true } },
		snapshot: deleteSnapshot(start.path, start.offset)
	});
	const caret = wrote ? pointAtByte(ctx.getDoc(), answer.caret.at) : null;
	return { wrote, caret, inText: answer.caret.holds === 'text' };
}

// ── Ordered lists numbered on ────────────────────────────────────────────────

/** `after`, the removal of `range` from `before`, with each ordered list it shortened numbered on
 *  (`docs/design/structural-edits.md` § Structural operations). */
export function numberedOn(
	tree: DocumentView,
	layout: Layout,
	before: string,
	range: Range,
	after: string
): string {
	const shift = after.length - before.length;
	const edits: Edit[] = [];
	for (const list of layout.within(range.from, range.to)) {
		const node = blockNodeAt(tree, list.path);
		if (!node?.children || !metadataIfKind(node, 'list')?.ordered) continue;
		const items = node.children.map((_, i) => layout.block([...list.path, i])!);
		const kept = items.filter((item) => item.from >= range.to);
		if (kept.length === 0 || kept.length === items.length) continue;
		const above = items.filter((item) => item.from < range.from).at(-1);
		let next = markerOf(before, above ?? items[0])?.number ?? 1;
		if (above) next++;
		for (const item of kept) {
			const marker = markerOf(before, item);
			if (marker && marker.number !== next) renumber(edits, before, item, marker, next);
			next++;
		}
	}
	if (edits.length === 0) return after;
	// One pass over the bytes: a long list renumbers every item after the range.
	const parts: string[] = [];
	let read = 0;
	for (const edit of edits.sort((a, b) => a.at - b.at)) {
		parts.push(after.slice(read, edit.at + shift), edit.insert);
		read = edit.at + shift + edit.remove;
	}
	parts.push(after.slice(read));
	return parts.join('');
}

interface Edit {
	at: number;
	remove: number;
	insert: string;
}

interface Marker {
	number: number;
	/** Where its digits sit in the bytes. */
	from: number;
	to: number;
}

/** An ordered item's number and where its digits sit; null for an item opening with none. */
function markerOf(source: string, item: LaidBlock): Marker | null {
	const line = item.lines?.[0];
	if (!line) return null;
	const digits = /^[ \t]*(\d+)/.exec(source.slice(line.from, line.markerTo));
	if (!digits) return null;
	const from = line.from + digits[0].length - digits[1].length;
	return { number: Number(digits[1]), from, to: from + digits[1].length };
}

/** Adds the edits that rewrite the item's digits as `number`, each later line indented to the
 *  item's text column where a wider or narrower number moves it. */
function renumber(edits: Edit[], source: string, item: LaidBlock, marker: Marker, number: number) {
	const insert = String(number);
	edits.push({ at: marker.from, remove: marker.to - marker.from, insert });
	const widened = insert.length - (marker.to - marker.from);
	const lines = item.lines!;
	const column = lines[0].markerTo - lines[0].from;
	for (const line of widened === 0 ? [] : lines.slice(1)) {
		if (line.markerTo - line.from !== column) continue;
		if (widened > 0) edits.push({ at: line.markerTo, remove: 0, insert: ' '.repeat(widened) });
		else if (/^ +$/.test(source.slice(line.markerTo + widened, line.markerTo)))
			edits.push({ at: line.markerTo + widened, remove: -widened, insert: '' });
	}
}

// ── Where the removal leaves the caret, read around it ───────────────────────

/** The kind of the block a command key's removal leaves the caret in, read before the removal, so
 *  the keymap of the block the command then runs in claims the key. */
export function commandLandingKind(doc: DocumentView, coverage: RangeCoverage): AnyBlockKind {
	const { start, end } = coverage.range;
	const grid = coverage.grid;
	if (grid && grid.kind !== 'table') return kindAt(doc, [...grid.path, 0, 0]);
	if (coverage.startEdge)
		return kindAt(doc, coverage.startCells ? [...start.path, 0, 0] : start.path);
	if (coverage.endEdge) return kindAt(doc, coverage.endCells ? [...end.path, 0, 0] : end.path);
	const roots = coverage.wholeRoots;
	const last = roots.at(-1) ?? end.path;
	const beside =
		previousCaretPath(doc, roots[0] ?? start.path) ??
		firstCaretLeafFrom(doc, [...last.slice(0, -1), last[last.length - 1] + 1]);
	// A removal that empties the document leaves it one empty paragraph.
	return beside ? kindAt(doc, beside) : 'paragraph';
}

/** Where text over the range opens a paragraph: the range took the block it started in and left
 *  the caret off any prose text, on a block's syntax or between blocks. Null where it types in place. */
export function emptiedPlace(
	committed: DocumentView,
	coverage: RangeCoverage,
	removed: Removed
): number[] | null {
	if (coverage.startEdge || coverage.grid || !removed.caret) return null;
	if (removed.inText && inProse(committed, removed.caret)) return null;
	const { start } = coverage.range;
	return liveSlot(
		committed,
		coverage.rootHolding(start.path) ?? coverage.wholeRoots[0] ?? start.path
	);
}

/** Whether text written at `point` reads as its block's text: a prose block, inside its content. */
function inProse(doc: DocumentView, point: SelectionPoint): boolean {
	const leaf = blockNodeAt(doc, point.path);
	if (!leaf) return true;
	const content = getContentRange(leaf);
	return isProseKind(leaf.kind) && point.offset >= content.start && point.offset <= content.end;
}

function kindAt(doc: DocumentView, path: readonly number[]): AnyBlockKind {
	return blockNodeAt(doc, [...path])?.kind ?? 'paragraph';
}
