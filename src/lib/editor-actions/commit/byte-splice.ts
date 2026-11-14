/**
 * The byte splice: the commit for an edit that decided its bytes before touching the tree. It makes
 * the byte changes, plus a closing line under any opener they write that a block below would close,
 * reads the top-level blocks they reach again, and lands the caret at a byte of the new bytes. No
 * list fix-up or open-tail step runs (`docs/design/commit-and-undo.md` § The byte splice).
 */

import type { CstNode } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import type { Landing } from '../../selection/primitives';
import type { BlockComponent } from '../../block-component';
import type { SourceSplice, SpliceCaret } from '../../action-contracts';
import type { ScopedOpDescriptor } from '../../schema/operations';
import { blockFacts } from '../../schema/block-facts';
import { blockNodeAt } from '../../tree-operations/node-primitives';
import { docPathFrom } from '../../core/coordinate-spaces';
import {
	runsOf,
	spliceReading,
	withWindows,
	type SpliceReading,
	type SpliceWindow
} from '../../tree-operations/byte-splice';
import type { ByteChange } from '../../tree-operations/byte-changes';
import {
	applyStructuralChangeToIdsRefs,
	replacePreservingFirst,
	type StructuralChange
} from '../../tree-operations/structural-change';
import { byteOfLeaf, leafAtByte } from '../../tree-operations/container-offsets';
import { topsOf, type Measured } from '../../tree-operations/top-level-starts';
import { readCurrentSelection } from '../../selection/native-bridge';
import type { BlockReach } from './change-record';
import type { GapCaretSelection } from '../../selection/gap-caret';
import { heldGapOf } from '../../selection/range-bytes';
import { replaceRefs } from '../../block-lists/child-refs';
import { assertIdsInLockstep, assertSpliceReadsBack } from '../../invariants/install';
import { assertInvariant } from '@voithos-labs/aragonite/dev-checks';
import {
	checkSplicedChangesClosed,
	splicedOpenerClosers,
	withSplicedClosers
} from '../../tree-operations/spliced-openers';
import { offsetPastClosers } from '../../tree-operations/written-openers';
import type { EditorActionsDeps } from '../deps';
import type { CommitArgs } from './structural-commit';
import type { ReplacedBlocks } from './emit-edit';

export function createByteSplice(
	deps: EditorActionsDeps,
	__commit: (args: CommitArgs) => Promise<boolean>
): (splice: SourceSplice) => Promise<boolean> {
	return (splice) => {
		const { grammar } = deps.reading;
		// Read before the write, so the check after it still reads the document as it stood.
		const was = deps.bytes.measured();
		const before = deps.bytes.source();
		let changes = splice.changes;
		let reading: SpliceReading | null = null;
		let windows: SpliceWindow[] = [];
		let caret: SpliceCaret | null = null;
		// Until the read finds the first window, the event names the block the snapshot sits in.
		const op: ScopedOpDescriptor = {
			eventPath: docPathFrom([splice.snapshot.path[0] ?? 0]),
			...splice.op
		};
		let saved: { children: CstNode[]; ids: string[]; refs: (BlockComponent | undefined)[] } | null =
			null;
		let replaced: ReplacedBlocks = 'unknown';
		return __commit({
			entry: 'commitSource',
			snapshot: splice.snapshot,
			op,
			history: splice.history ?? 'entry',
			reach: () => reachOf(windows),
			discardIfNoop: true,
			// Inside the frame, so a block opener that throws on the new bytes fails the write.
			prepare: () => {
				const read = spliceReading(was, before, splice.changes, grammar);
				const closers = read
					? splicedOpenerClosers(was, before, splice.changes, read, grammar)
					: [];
				if (closers.length > 0) changes = withSplicedClosers(before, splice.changes, closers);
				reading = closers.length > 0 ? spliceReading(was, before, changes, grammar) : read;
				// The record already reported what it found, so the write is refused with no second error.
				if (reading && !tookTreeBytes(deps, reading)) return false;
				windows = reading?.windows ?? [];
				if (!('eventPath' in splice.op)) op.eventPath = docPathFrom([windows[0]?.at ?? 0]);
				// Measured in the caller's bytes, then past the closers, so a caret inside a write stays
				// in front.
				const named =
					splice.caret === 'keep' ? caretKept(deps, splice.changes, windows) : splice.caret;
				caret = named && { ...named, at: offsetPastClosers(named.at, closers) };
				return true;
			},
			apply: () => {
				if (!reading) return false;
				saved = { children: deps.doc.children, ids: deps.blockIds, refs: [...deps.blockRefs] };
				replaced = installReading(deps, reading, topsOf(was));
				// A range the editor holds names the blocks just replaced; the landing puts the caret down.
				if (deps.selectionState.ownsRange) {
					deps.selectionState.clear();
					deps.caretWriter.clear();
				}
				return true;
			},
			written: () => {
				// Re-read through the tree, whose proxies are the nodes from here on.
				const tops = placed(windows).flatMap(({ at, count }) =>
					deps.doc.children.slice(at, at + count)
				);
				return { nodes: tops, tops };
			},
			replaced: () => replaced,
			touched: () => runsOf(windows),
			check: () => {
				assertSpliceReadsBack(deps.doc.children, placed(windows), grammar);
				if (reading)
					assertInvariant('spliced-opener-closed', () =>
						checkSplicedChangesClosed(was, before, changes, reading!, grammar)
					);
			},
			rollback: () => {
				if (!saved) return;
				deps.doc.children = saved.children;
				deps.setBlockIds(saved.ids);
				replaceRefs(deps.blockRefs, saved.refs);
			},
			landing: () => caret && landingAt(deps.bytes.measured(), caret),
			reveal: splice.reveal
		});
	};
}

/** Whether what the editor keeps of the blocks `reading` took its bytes from is what the tree
 *  holds: asked before the reading is installed (`KeptStarts.vouch`). */
export function tookTreeBytes(
	deps: Pick<EditorActionsDeps, 'starts'>,
	reading: SpliceReading
): boolean {
	return reading.took.every(({ from, to }) => deps.starts.vouch(from, to));
}

/** The live document's top-level blocks (`tops`, a plain list of them as they stand) read again as
 *  `reading` says, ids and refs moved with them. Returns the blocks it replaced. */
export function installReading(
	deps: EditorActionsDeps,
	reading: SpliceReading,
	tops: readonly NodeView[]
): ReplacedBlocks {
	const replaced = replacedBy(tops, reading.windows);
	// A new list: on the tree's `$state` proxy every index a splice shifts is a tracked write.
	const children = withWindows(tops, reading.windows);
	const ids = [...deps.blockIds];
	const refs = [...deps.blockRefs];
	// Last window first, so each one's indices still hold.
	for (const window of [...reading.windows].reverse()) {
		// The reading gave its blocks their ids, so a window holding a long container's kept
		// children walks none of them.
		for (const block of window.blocks) deps.sharing.stamp(block);
		applyStructuralChangeToIdsRefs(changeOf(window), ids, refs);
	}
	deps.doc.children = children;
	deps.doc.suffix = reading.suffix;
	assertIdsInLockstep('byte splice', ids.length, children.length);
	deps.setBlockIds(ids);
	replaceRefs(deps.blockRefs, refs);
	return replaced;
}

// ── Internal ─────────────────────────────────────────────────────────────────

/** The blocks `windows` take out of `tops` and put in; a window inside a container names only the
 *  run of its children read again, so a long list isn't walked whole. */
function replacedBy(tops: readonly NodeView[], windows: readonly SpliceWindow[]): ReplacedBlocks {
	const kids = (at: number) => tops[at].children ?? [];
	return {
		before: windows.flatMap(({ at, count, run }) =>
			run ? kids(at).slice(run.at, run.at + run.count) : tops.slice(at, at + count)
		),
		after: windows.flatMap(({ at, blocks, run }) => {
			if (!run) return blocks;
			const now = blocks[0].children ?? [];
			return now.slice(run.at, run.at + run.count + now.length - kids(at).length);
		})
	};
}

function changeOf({ at, count, blocks }: SpliceWindow): StructuralChange {
	if (count > 0 && blocks.length > 0) return replacePreservingFirst(at, count, blocks.length);
	if (blocks.length > 0) return { op: 'insert', at, count: blocks.length };
	return count > 0 ? { op: 'delete', at, count } : { op: 'noop' };
}

/** The top-level blocks the windows replace, and every one between them. */
function reachOf(windows: readonly SpliceWindow[]): BlockReach {
	const last = windows.at(-1);
	return last ? { from: windows[0].at, to: last.at + Math.max(last.count, 1) } : { from: 0, to: 0 };
}

/** The author's caret past `changes`, put back only where a window read its block again: elsewhere
 *  it stays as it is, an IME composition included. Null with no caret, or none to move. */
function caretKept(
	deps: EditorActionsDeps,
	changes: readonly ByteChange[],
	windows: readonly SpliceWindow[]
): SpliceCaret | null {
	const live = readCurrentSelection(deps.selectionState, deps.blockRefs);
	if (!live || live.focus.cellCoordinate) return null;
	const top = live.focus.path[0];
	const reread = windows.some(({ at, count }) => top >= at && top < at + count);
	if (!reread && !deps.selectionState.ownsRange) return null;
	let at = byteOfLeaf(deps.bytes.measured(), live.focus.path, live.focus.offset);
	if (at === null) return null;
	let shift = 0;
	for (const change of changes) {
		if (at < change.from) break;
		if (at < change.to) return { at: change.from + shift + change.insert.length, holds: 'text' };
		shift += change.insert.length - (change.to - change.from);
	}
	at += shift;
	return { at, holds: 'text' };
}

/** Where each window's blocks stand once every window is in. */
function placed(windows: readonly SpliceWindow[]): { at: number; count: number }[] {
	let shift = 0;
	return windows.map(({ at, count, blocks }) => {
		const span = { at: at + shift, count: blocks.length };
		shift += blocks.length - count;
		return span;
	});
}

/** The caret at byte `caret.at`: the gap caret a boundary is held as, else text at that byte
 *  exactly, else the block's own landing (a block held whole, or a picture of its source). */
export function landingAt(
	measured: Measured,
	caret: SpliceCaret
): Landing | GapCaretSelection | null {
	if (caret.holds === 'boundary') {
		const gap = heldGapOf(measured, caret);
		if (gap) return { gapCaret: gap };
	}
	const leaf = leafAtByte(measured, caret.at);
	if (!leaf) return null;
	const point = { path: docPathFrom(leaf.path), offset: leaf.offset };
	const kind = blockNodeAt(measured.doc, leaf.path)?.kind;
	const exact = caret.holds === 'text' && kind && blockFacts(kind).textPosition === 'always';
	// Put down as a stored caret is, since a kind's own landing rule would move it off the byte.
	return exact ? { anchor: point, focus: point } : point;
}
