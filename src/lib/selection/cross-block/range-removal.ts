/**
 * A range's removal through the range-edit core, and text over a range inside one table cell: the
 * selection read as bytes and the core's answer landed as one byte splice. Every gesture that
 * removes a range the editor holds goes through here, and so does a block removed whole.
 */

import type { SourceSplice, SpliceCaret } from '../../action-contracts';
import type { DocumentView } from '../../core/node-views';
import type { AnyBlockKind } from '../../core/nodes';
import { hidesDelimitersAtCaret } from '../../presentation-mode';
import {
	removalOf,
	textInCell,
	wholeBlocksRemovalOf,
	type RemovalGesture
} from '../../range-edit/edit-range';
import { rangeHost } from '../../range-edit/host';
import { changesBetween } from '../../tree-operations/byte-changes';
import { blockNodeAt } from '../../tree-operations/node-primitives';
import type { Measured } from '../../tree-operations/top-level-starts';
import { deleteSnapshot, type SelectionPoint } from '../primitives';
import type { RemovalGesture as BlockGesture } from '../caret-target';

import { firstCaretLeafFrom, previousCaretPath } from '../path-lookup';
import {
	endsOf,
	heldGapOf,
	pointAtByte,
	rangeRead,
	readsAsText,
	removalBytes,
	takenGapOf,
	wholeBlockBytes
} from '../range-bytes';
import type { RangeCoverage } from '../range-coverage';
import type { CrossBlockDispatchContext } from './dispatch';

export type RemovalContext = Pick<
	CrossBlockDispatchContext,
	'bytes' | 'reading' | 'controller' | 'getDoc'
>;

/** What a removal reads and commits through, the caret read back aside. */
type CommitContext = Omit<RemovalContext, 'getDoc'>;

type RemovalCommit = Pick<SourceSplice, 'op' | 'snapshot'> & { caret: SpliceCaret };

export interface Removed {
	/** False also where the range held nothing to take, which leaves the caret at its start. */
	wrote: boolean;
	/** Where the removal left the caret, read on the committed tree. */
	caret: SelectionPoint | null;
	/** The core's caret: its byte, and whether text, a block held whole or a boundary sits there. */
	landed: SpliceCaret | null;
	/** Where the block the range started in stood, read on the bytes after, when the removal took
	 *  it. */
	taken: { at: number; parent: readonly number[] } | null;
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
	const read = rangeRead(ctx.bytes, endsOf(coverage), (layout) =>
		removalBytes(tree, coverage, layout)
	);
	if (!read) return { wrote: false, caret: null, landed: null, taken: null };
	const { source, range } = read;
	const answer = removalOf(source, range, gesture, modeOf(ctx), rangeHost(ctx.reading, read));
	const landed = answer.caret;
	// A range holding nothing to take (an end narrowed to the text before it) is a caret there.
	if (answer.source === source)
		return {
			wrote: false,
			caret: pointAtByte(ctx.bytes.measured(), landed.at),
			landed,
			taken: null
		};
	const { start } = coverage.range;
	const wrote = await commitBytes(ctx, answer.source, {
		caret: landed,
		op: { kind: 'delete', detail: { crossBlock: true } },
		snapshot: deleteSnapshot(start.path, start.offset)
	});
	const caret = wrote ? pointAtByte(ctx.bytes.measured(), landed.at) : null;
	return { wrote, caret, landed, taken: answer.taken ?? null };
}

/** Removes the block at `path` whole, as the block menu's Delete does, in one commit whose edit
 *  event and undo snapshot the caller names; the caret lands on the side `gesture` points. */
export function removeWholeBlock(
	ctx: CommitContext,
	path: readonly number[],
	gesture: BlockGesture,
	commit: Omit<RemovalCommit, 'caret'>
): Promise<boolean> {
	const tree = ctx.bytes.doc();
	const read = rangeRead(ctx.bytes, [path], (layout) => wholeBlockBytes(tree, layout, path));
	if (!read) return Promise.resolve(false);
	const answer = wholeBlocksRemovalOf(
		read.source,
		read.range,
		CORE_GESTURE[gesture],
		modeOf(ctx),
		rangeHost(ctx.reading, read)
	);
	return commitBytes(ctx, answer.source, { ...commit, caret: answer.caret });
}

/** Writes `text` over what `coverage` holds inside one table cell as one write of the cell, in one
 *  commit; null for a range anywhere else, or text holding a line break. */
export async function writeInCell(
	ctx: RemovalContext,
	coverage: RangeCoverage,
	text: string
): Promise<boolean | null> {
	const tree = ctx.bytes.doc();
	const read = rangeRead(ctx.bytes, endsOf(coverage), (layout) =>
		removalBytes(tree, coverage, layout)
	);
	const answer =
		read && textInCell(read.source, read.range, text, modeOf(ctx), rangeHost(ctx.reading, read));
	if (!answer || !read) return null;
	const { source } = read;
	const { start } = coverage.range;
	const length =
		(blockNodeAt(tree, start.path)?.raw.length ?? 0) + answer.source.length - source.length;
	return commitBytes(ctx, answer.source, {
		caret: answer.caret,
		op: { kind: 'updateContent', detail: { length } },
		snapshot: deleteSnapshot(start.path, start.offset)
	});
}

/** The core's new bytes landed as one byte splice. */
function commitBytes(ctx: CommitContext, after: string, splice: RemovalCommit): Promise<boolean> {
	const changes = changesBetween(ctx.bytes.source(), after);
	return ctx.controller.commitSource({ changes, ...splice });
}

const modeOf = (ctx: CommitContext) =>
	hidesDelimitersAtCaret(ctx.reading.mode()) ? 'live' : 'source';

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

/** Where text over the range opens a paragraph: the boundary the core's place is held at, or the
 *  block the range started in, taken, with the caret off prose. Null types in place. */
export function emptiedPlace(measured: Measured, removed: Removed): number[] | null {
	const { doc: committed } = measured;
	const { landed, caret, taken } = removed;
	if (!landed || !removed.wrote) return null;
	if (landed.holds === 'boundary') {
		const gap = heldGapOf(measured, landed);
		if (gap) return [...gap.parentPath, gap.index];
	}
	// A boundary held as no gap leaves the caret on the text at its byte.
	if (!taken || (caret && landed.holds !== 'block' && inProse(committed, caret))) return null;
	const gap = takenGapOf(measured, taken);
	return gap && [...gap.parentPath, gap.index];
}

/** Whether text written at `point` reads as its block's text. */
function inProse(doc: DocumentView, point: SelectionPoint): boolean {
	const leaf = blockNodeAt(doc, point.path);
	return !leaf || readsAsText(leaf, point.offset);
}

function kindAt(doc: DocumentView, path: readonly number[]): AnyBlockKind {
	return blockNodeAt(doc, [...path])?.kind ?? 'paragraph';
}
