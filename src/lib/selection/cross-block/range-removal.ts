/**
 * A range's removal through the range-edit core: the selection read as bytes, the core's answer
 * with every ordered list it shortened numbered on, landed as one byte splice. Every gesture that
 * removes a range the editor holds goes through here, and so does a block removed whole.
 */

import type { SourceSplice, SpliceCaret } from '../../action-contracts';
import type { DocumentView } from '../../core/node-views';
import { metadataIfKind, type AnyBlockKind } from '../../core/nodes';
import { getContentRange, isProseKind } from '../../core/inline';
import { serialize } from '../../core/serializer';
import { hidesDelimitersAtCaret } from '../../presentation-mode';
import {
	removalOf,
	wholeBlocksRemovalOf,
	type Range,
	type RemovalGesture
} from '../../range-edit/edit-range';
import { rangeHost } from '../../range-edit/host';
import type { LaidBlock, Layout } from '../../range-edit/layout';
import { changesBetween } from '../../tree-operations/byte-changes';
import { blockNodeAt } from '../../tree-operations/node-primitives';
import { deleteSnapshot, type SelectionPoint } from '../primitives';
import { liveSlot, type RemovalGesture as BlockGesture } from '../caret-target';

import { firstCaretLeafFrom, previousCaretPath } from '../path-lookup';
import { gapAtByte, pointAtByte, removalBytes, wholeBlockBytes } from '../range-bytes';
import type { RangeCoverage } from '../range-coverage';
import type { CrossBlockDispatchContext } from './dispatch';

export type RemovalContext = Pick<
	CrossBlockDispatchContext,
	'bytes' | 'reading' | 'controller' | 'getDoc'
>;

/** What a removal reads and commits through, the caret read back aside. */
type CommitContext = Omit<RemovalContext, 'getDoc'>;

type RemovalCommit = Pick<SourceSplice, 'caret' | 'op' | 'snapshot'>;

export interface Removed {
	/** False also where the range held nothing to take, which leaves the caret at its start. */
	wrote: boolean;
	/** Where the removal left the caret, read on the committed tree. */
	caret: SelectionPoint | null;
	/** The core's caret: its byte, and whether text, a block held whole or a boundary sits there. */
	landed: SpliceCaret | null;
	/** The block the range started in, by its path before the removal, when the removal took it. */
	took: readonly number[] | null;
}

/** How the core names the removal each block gesture makes: a delete no key asked for removes as
 *  a command key does, from the side Backspace takes. */
export const CORE_GESTURE: Record<BlockGesture, RemovalGesture> = {
	Backspace: 'backspace',
	Delete: 'delete',
	cut: 'cut',
	keyless: 'command'
};

/** Removes what `coverage` holds as `gesture` does, in one commit. */
export async function removeThroughCore(
	ctx: RemovalContext,
	coverage: RangeCoverage,
	gesture: RemovalGesture
): Promise<Removed> {
	const tree = ctx.bytes.doc();
	const range = removalBytes(tree, coverage, ctx.bytes.layout());
	if (!range) return { wrote: false, caret: null, landed: null, took: null };
	const source = ctx.bytes.source();
	const answer = removalOf(source, range, gesture, modeOf(ctx), hostOf(ctx));
	const landed = answer.caret;
	// A range holding nothing to take (an end narrowed to the text before it) is a caret there.
	if (answer.source === source)
		return { wrote: false, caret: pointAtByte(tree, landed.at), landed, took: null };
	const { start } = coverage.range;
	const wrote = await commitRemoval(ctx, range, answer.source, {
		caret: landed,
		op: { kind: 'delete', detail: { crossBlock: true } },
		snapshot: deleteSnapshot(start.path, start.offset)
	});
	const caret = wrote ? pointAtByte(ctx.getDoc(), landed.at) : null;
	return { wrote, caret, landed, took: answer.took ?? null };
}

/** Removes the block at `path` whole, as the block menu's Delete does, in one commit whose caret,
 *  edit event and undo snapshot the caller names. */
export function removeWholeBlock(
	ctx: CommitContext,
	path: readonly number[],
	commit: RemovalCommit
): Promise<boolean> {
	const range = wholeBlockBytes(ctx.bytes.doc(), ctx.bytes.layout(), path);
	if (!range) return Promise.resolve(false);
	const after = wholeBlocksRemovalOf(ctx.bytes.source(), range, modeOf(ctx), hostOf(ctx));
	return commitRemoval(ctx, range, after, commit);
}

/** The core's new bytes landed as one byte splice, each ordered list they shortened numbered on. */
function commitRemoval(
	ctx: CommitContext,
	range: Range,
	removed: string,
	splice: RemovalCommit
): Promise<boolean> {
	const tree = ctx.bytes.doc();
	const source = ctx.bytes.source();
	const after = numberedOn(tree, ctx.bytes.layout(), source, range, removed);
	return ctx.controller.commitSource({ changes: changesBetween(source, after), ...splice });
}

const modeOf = (ctx: CommitContext) =>
	hidesDelimitersAtCaret(ctx.reading.mode()) ? 'live' : 'source';

const hostOf = (ctx: CommitContext) =>
	rangeHost(ctx.reading, {
		source: ctx.bytes.source(),
		tree: ctx.bytes.doc(),
		layout: ctx.bytes.layout()
	});

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

/** Where text over the range opens a paragraph, by the core's answer: the boundary its caret sits
 *  on, or the block the range started in, taken, with the caret off prose. Null types in place. */
export function emptiedPlace(committed: DocumentView, removed: Removed): number[] | null {
	const { landed, caret, took } = removed;
	if (!landed || !removed.wrote) return null;
	if (landed.holds === 'boundary') {
		const gap = gapAtByte(committed, landed.at);
		if (gap) return [...gap.parentPath, gap.index];
		// The root's trailing boundary takes no gap caret, but a paragraph opens there all the same.
		const end = serialize(committed).length - committed.suffix.length;
		return landed.at >= end ? [committed.children.length] : null;
	}
	if (!took || (caret && landed.holds === 'text' && inProse(committed, caret))) return null;
	return liveSlot(committed, took);
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
