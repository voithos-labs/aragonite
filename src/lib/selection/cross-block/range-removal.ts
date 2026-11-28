/**
 * A range's removal through the range-edit core, and text over a range inside one table cell: the
 * selection read as bytes and the core's answer landed as one byte splice. Every gesture that
 * removes a range the editor holds goes through here, and so does a block removed whole.
 */

import type { SourceSplice, SpliceCaret } from '../../action-contracts';
import type { DocumentView } from '../../core/node-views';
import type { AnyBlockKind } from '../../core/nodes';
import { isBlankText } from '../../core/lines';
import { hidesDelimitersAtCaret } from '../../presentation-mode';
import {
	besideEdge,
	removalOf,
	textInCell,
	wholeBlocksRemovalOf,
	type RemovalAnswer,
	type RemovalGesture
} from '../../range-edit/edit-range';
import { readsAsText } from '../../range-edit/document';
import { rangeHost } from '../../range-edit/host';
import {
	afterRangeRemovalCommands,
	commandOverRange,
	type CommandDispatchContext
} from '../../schema/block-commands';
import { chordsBoundTo, resolveBinding } from '../../schema/commands';
import { changesBetween } from '../../tree-operations/byte-changes';
import { blockNodeAt } from '../../tree-operations/node-primitives';
import type { Measured } from '../../tree-operations/top-level-starts';
import { deleteSnapshot, type SelectionPoint } from '../primitives';
import type { RemovalGesture as BlockGesture } from '../caret-target';

import {
	endsOf,
	heldGapOf,
	pointAtByte,
	rangeRead,
	removalBytes,
	takenGapOf,
	wholeBlockBytes,
	type DocumentBytes,
	type RangeRead
} from '../range-bytes';
import type { RangeCoverage } from '../range-coverage';
import type { CrossBlockDispatchContext } from './dispatch';

export type RemovalContext = Pick<
	CrossBlockDispatchContext,
	'bytes' | 'reading' | 'controller' | 'getDoc'
>;

/** What a range edit reads and commits through, the caret read back aside. */
export type CommitContext = Omit<RemovalContext, 'getDoc'>;

export type CoreCommit = Pick<SourceSplice, 'op' | 'snapshot' | 'history' | 'removal'> & {
	caret: SpliceCaret;
};

export interface Removed {
	/** False also where the range held nothing to take, which leaves the caret at its start. */
	wrote: boolean;
	/** Where the removal left the caret, read on the committed tree. */
	caret: SelectionPoint | null;
	/** The core's caret: its byte, and whether text, a block held whole or a boundary sits there. */
	landed: SpliceCaret | null;
	/** Where the block the range started in stood, read on the bytes after, when the removal took
	 *  it; `own` where some of the leaf the range ended in follows it. */
	taken: { at: number; parent: readonly number[]; own: boolean } | null;
}

/** How the core names the removal each block gesture makes: a delete no key asked for removes as
 *  a command key does, from the side Backspace takes. */
export const CORE_GESTURE: Record<BlockGesture, RemovalGesture> = {
	Backspace: 'backspace',
	Delete: 'delete',
	cut: 'cut',
	keyless: 'command'
};

type Keymap = Pick<CommandDispatchContext, 'keybindingOverrides' | 'activation'>;

/** Whether some keymap binds `chord` to a command that runs after a range's removal, which over a
 *  range runs at the core's place for text. */
export function bindsAfterRemoval(chord: string, commands: Keymap): boolean {
	return chordsBoundTo(afterRangeRemovalCommands(commands.activation), commands).has(chord);
}

/** Whether a key, or a break that came as input, runs at the core's place in a block of `kind`: its
 *  chord there runs after a removal, and a break input bound to nothing still counts as one. */
export function runsAtPlace(
	kind: AnyBlockKind,
	insertion: { kind: 'command' | 'break'; chord: string },
	commands: Keymap
): boolean {
	const command = boundIn(kind, insertion.chord, commands);
	if (command === undefined) return insertion.kind === 'break';
	return commandOverRange(kind, command, commands.activation) !== undefined;
}

/** Whether `chord` runs Enter's split in a paragraph, which an empty paragraph opened for it is. */
export function splitsParagraph(chord: string, commands: Keymap): boolean {
	return boundIn('paragraph', chord, commands) === 'block.split';
}

const boundIn = (kind: AnyBlockKind, chord: string, commands: Keymap) =>
	resolveBinding(chord, kind, commands.keybindingOverrides(), commands.activation)?.command;

/** Removes what `coverage` holds as `gesture` does, in one commit. */
export async function removeThroughCore(
	ctx: RemovalContext,
	coverage: RangeCoverage,
	gesture: RemovalGesture
): Promise<Removed> {
	const removal = removalAnswer(ctx, coverage, gesture);
	if (!removal) return { wrote: false, caret: null, landed: null, taken: null };
	return commitRemoval(ctx, coverage, gesture, removal);
}

/** The core's answer for a removal, and the read it was answered on. */
export interface RemovalRead {
	read: RangeRead;
	answer: RemovalAnswer;
}

/** The core's answer for removing what `coverage` holds as `gesture` does, nothing committed; null
 *  where the coverage reads as no bytes. */
export function removalAnswer(
	ctx: RemovalContext,
	coverage: RangeCoverage,
	gesture: RemovalGesture
): RemovalRead | null {
	const tree = ctx.bytes.doc();
	const read = rangeRead(ctx.bytes, endsOf(coverage), (layout) =>
		removalBytes(tree, coverage, layout)
	);
	if (!read) return null;
	const host = rangeHost(ctx.reading, read);
	return { read, answer: removalOf(read.source, read.range, gesture, modeOf(ctx), host) };
}

/** `removal`, of what `coverage` holds as `gesture` does, in one commit. */
export async function commitRemoval(
	ctx: RemovalContext,
	coverage: RangeCoverage,
	gesture: RemovalGesture,
	{ read, answer }: RemovalRead
): Promise<Removed> {
	// A range holding nothing to take (an end narrowed to the text before it) is a caret there.
	if (answer.source === read.source) return removedIn(ctx.bytes, answer, false);
	const landed = answer.caret;
	const { start } = coverage.range;
	const wrote = await commitBytes(ctx, answer.source, {
		caret: landed,
		op: { kind: 'delete', detail: { crossBlock: true } },
		snapshot: deleteSnapshot(start.path, start.offset),
		removal: true
	});
	if (!wrote) return { wrote, caret: null, landed, taken: null };
	if (gesture === 'cut') rememberCut(ctx, answer);
	return removedIn(ctx.bytes, answer, true);
}

/** What `answer` left, read on `bytes`, the document holding its bytes. */
function removedIn(bytes: DocumentBytes, answer: RemovalAnswer, wrote: boolean): Removed {
	const caret = pointAtByte(bytes.measured(), answer.caret.at);
	return { wrote, caret, landed: answer.caret, taken: wrote ? (answer.taken ?? null) : null };
}

/** Removes the block at `path` whole, as the block menu's Delete does, in one commit whose edit
 *  event and undo snapshot the caller names; the caret lands on the side `gesture` points. */
export async function removeWholeBlock(
	ctx: CommitContext,
	path: readonly number[],
	gesture: BlockGesture,
	commit: Omit<CoreCommit, 'caret'>
): Promise<boolean> {
	const tree = ctx.bytes.doc();
	const read = rangeRead(ctx.bytes, [path], (layout) => wholeBlockBytes(tree, layout, path));
	if (!read) return false;
	const answer = wholeBlocksRemovalOf(
		read.source,
		read.range,
		CORE_GESTURE[gesture],
		modeOf(ctx),
		rangeHost(ctx.reading, read)
	);
	const wrote = await commitBytes(ctx, answer.source, {
		...commit,
		caret: answer.caret,
		removal: true
	});
	if (wrote && gesture === 'cut') rememberCut(ctx, answer);
	return wrote;
}

/** Keeps the caret the core named for a cut, and the byte its entry fits at, for the paste that
 *  puts the cut back there. */
function rememberCut(ctx: CommitContext, { caret, unlanded }: RemovalAnswer): void {
	ctx.bytes.cut = { caret, fits: unlanded, of: ctx.bytes.source() };
}

/** Where Backspace at the start of the block at `path` (`dir` -1), or Delete at its end (1), lands
 *  when it joins nothing: the core's place beside it, read on the bytes as they stand. */
export function placeBeside(
	ctx: Pick<CommitContext, 'bytes' | 'reading'>,
	path: readonly number[],
	dir: -1 | 1
): { place: SpliceCaret; measured: Measured } | null {
	const edge = dir < 0 ? path : [...path.slice(0, -1), path.at(-1)! + 1];
	const read = rangeRead(ctx.bytes, [edge], (layout) => {
		const from = layout.block(edge)?.from;
		return from === undefined ? null : { from, to: from };
	});
	if (!read) return null;
	const gesture = dir < 0 ? 'backspace' : 'delete';
	const host = rangeHost(ctx.reading, read);
	const place = besideEdge(read.source, read.range.from, gesture, modeOf(ctx), host);
	return place && { place, measured: read.measured };
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
export function commitBytes(
	ctx: CommitContext,
	after: string,
	splice: CoreCommit
): Promise<boolean> {
	const changes = changesBetween(ctx.bytes.source(), after);
	return ctx.controller.commitSource({ changes, ...splice });
}

export const modeOf = (ctx: Pick<CommitContext, 'reading'>) =>
	hidesDelimitersAtCaret(ctx.reading.mode()) ? 'live' : 'source';

// ── Where the removal leaves the caret, read around it ───────────────────────

/** The kind of the cell a command key's removal over a table's cells leaves the caret in, the one
 *  range with no place for text; null for any other. */
export function cellLandingKind(doc: DocumentView, coverage: RangeCoverage): AnyBlockKind | null {
	const grid = coverage.grid;
	return grid && grid.kind !== 'table' ? kindAt(doc, [...grid.path, 0, 0]) : null;
}

/** Where text over the range opens a paragraph: the gap the core's place is held at, or where the
 *  taken block stood, unless the caret is on text the range left of its own. Null types in place. */
export function emptiedPlace(
	measured: Measured,
	removed: Removed,
	anyProse: boolean
): number[] | null {
	const { doc: committed } = measured;
	const { landed, caret, taken } = removed;
	if (!landed || !removed.wrote) return null;
	if (landed.holds === 'boundary') {
		const gap = heldGapOf(measured, landed);
		if (gap) return [...gap.parentPath, gap.index];
	}
	// The core's caret on the rest of the leaf the range ended in, a code line's too, takes the text.
	if (!taken || (taken.own && landed.holds === 'text')) return null;
	// A boundary held as no gap leaves the caret on the text at its byte.
	const prose = !!caret && landed.holds !== 'block' && inProse(committed, caret);
	// The range's own: the rest of the leaf it ended in, or an empty line; for `anyProse`, any prose
	// that starts where the taken block stood, not text past a block's own syntax (a heading's `# `).
	const beside = anyProse && landed.at === taken.at;
	const own = beside || taken.own || (!!caret && emptyLine(committed, caret));
	if (prose && own) return null;
	const gap = takenGapOf(measured, taken);
	return gap && [...gap.parentPath, gap.index];
}

/** Whether text written at `point` reads as its block's text. */
function inProse(doc: DocumentView, point: SelectionPoint): boolean {
	const leaf = blockNodeAt(doc, point.path);
	return !leaf || readsAsText(leaf, point.offset);
}

/** Whether `point` sits in a block with no text, a line the removal left empty. */
function emptyLine(doc: DocumentView, point: SelectionPoint): boolean {
	const leaf = blockNodeAt(doc, point.path);
	return !!leaf && isBlankText(leaf.raw);
}

function kindAt(doc: DocumentView, path: readonly number[]): AnyBlockKind {
	return blockNodeAt(doc, [...path])?.kind ?? 'paragraph';
}
