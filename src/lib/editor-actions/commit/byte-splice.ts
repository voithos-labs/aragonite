/**
 * The byte splice: the commit for an edit that decided its bytes before touching the tree. It makes
 * the byte changes, reads the top-level blocks they reach again, and lands the caret at a byte of
 * the new bytes. The bytes are final, so neither the list fix-up nor the open-tail step runs; the
 * commit frame does the rest (`docs/design/commit-and-undo.md` § The byte splice).
 */

import type { CstNode } from '../../core/nodes';
import type { DocumentView } from '../../core/node-views';
import type { Landing } from '../../selection/primitives';
import type { BlockComponent } from '../../block-component';
import type { SourceSplice, SpliceCaret } from '../../action-contracts';
import { serialize } from '../../core/serializer';
import { docPathFrom } from '../../core/coordinate-spaces';
import { spliceMany } from '../../tree-operations/splice-many';
import {
	spliceReading,
	type ByteChange,
	type SpliceReading,
	type SpliceWindow
} from '../../tree-operations/byte-splice';
import {
	applyStructuralChangeToIdsRefs,
	replacePreservingFirst,
	stampStructuralChange,
	type StructuralChange
} from '../../tree-operations/structural-change';
import { byteOfLeaf, childRawStarts, leafAtByte } from '../../tree-operations/container-offsets';
import { readCurrentSelection } from '../../selection/native-bridge';
import type { BlockReach } from './change-record';
import {
	gapEligibleAt,
	type GapCaretPosition,
	type GapCaretSelection
} from '../../selection/gap-caret';
import { replaceRefs } from '../../block-lists/child-refs';
import { assertIdsInLockstep, assertSpliceReadsBack } from '../../invariants/install';
import type { EditorActionsDeps } from '../deps';
import type { CommitArgs } from './structural-commit';

export function createByteSplice(
	deps: EditorActionsDeps,
	__commit: (args: CommitArgs) => Promise<boolean>
): (splice: SourceSplice) => Promise<boolean> {
	return (splice) => {
		const reading = spliceReading(
			deps.doc,
			serialize(deps.doc),
			splice.changes,
			deps.reading.grammar
		);
		const windows = reading?.windows ?? [];
		const kept = splice.caret === 'keep' ? caretKept(deps, splice.changes, windows) : null;
		let saved: { children: CstNode[]; ids: string[]; refs: (BlockComponent | undefined)[] } | null =
			null;
		return __commit({
			entry: 'commitSource',
			snapshot: splice.snapshot,
			op: { ...splice.op, eventPath: docPathFrom([windows[0]?.at ?? 0]) },
			history: splice.history ?? 'entry',
			reach: () => reachOf(windows),
			discardIfNoop: true,
			apply: () => {
				if (!reading) return false;
				saved = { children: deps.doc.children, ids: deps.blockIds, refs: [...deps.blockRefs] };
				installReading(deps, reading);
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
			check: () => assertSpliceReadsBack(deps.doc.children, placed(windows), deps.reading.grammar),
			rollback: () => {
				if (!saved) return;
				deps.doc.children = saved.children;
				deps.setBlockIds(saved.ids);
				replaceRefs(deps.blockRefs, saved.refs);
			},
			landing: () => {
				const caret = splice.caret === 'keep' ? kept : splice.caret;
				return caret && landingAt(deps.doc, caret);
			},
			reveal: splice.reveal
		});
	};
}

/** The live document's top-level blocks read again as `reading` says, ids and refs moved with
 *  them; blocks outside its windows keep their nodes. */
export function installReading(deps: EditorActionsDeps, reading: SpliceReading): void {
	// Off the tree's `$state` proxy, where every index a splice shifts is a tracked write.
	const children = [...deps.doc.children];
	const ids = [...deps.blockIds];
	const refs = [...deps.blockRefs];
	// Last window first, so each one's indices still hold.
	for (const window of [...reading.windows].reverse()) {
		spliceMany(children, window.at, window.count, window.blocks);
		const change = changeOf(window);
		stampStructuralChange(children, change, deps.sharing);
		applyStructuralChangeToIdsRefs(change, ids, refs);
	}
	deps.doc.children = children;
	deps.doc.suffix = reading.suffix;
	assertIdsInLockstep('byte splice', ids.length, children.length);
	deps.setBlockIds(ids);
	replaceRefs(deps.blockRefs, refs);
}

// ── Internal ─────────────────────────────────────────────────────────────────

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
	let at = byteOfLeaf(deps.doc, live.focus.path, live.focus.offset);
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

/** The caret at byte `caret.at` of the document's bytes, through the leaf holding it (a block held
 *  whole focuses itself), or the gap caret between blocks. */
function landingAt(doc: DocumentView, caret: SpliceCaret): Landing | GapCaretSelection | null {
	if (caret.holds === 'boundary') {
		const gap = gapAtByte(doc, caret.at);
		if (gap) return { gapCaret: gap };
	}
	const leaf = leafAtByte(doc, caret.at);
	if (!leaf) return null;
	return { path: docPathFrom(leaf.path), offset: leaf.offset };
}

/** The deepest boundary a gap caret may take where a block starts, or a container ends, at byte
 *  `at`; null where none may. */
export function gapAtByte(doc: DocumentView, at: number): GapCaretPosition | null {
	let found: GapCaretPosition | null = null;
	let parentPath: number[] = [];
	let children = doc.children;
	let starts = topLevelStarts(doc);
	let base = 0;
	let end = serialize(doc).length;
	for (;;) {
		const index = at === end ? children.length : starts.findIndex((s) => base + s === at);
		if (index >= 0 && gapEligibleAt(doc, parentPath, index)) found = { parentPath, index };
		let i = children.length - 1;
		while (i > 0 && base + starts[i] > at) i--;
		const child = children[i];
		if (!child?.children?.length) return found;
		base += starts[i];
		end = base + child.raw.length;
		parentPath = [...parentPath, i];
		starts = childRawStarts(child);
		children = child.children;
	}
}

function topLevelStarts(doc: DocumentView): number[] {
	const starts: number[] = [];
	let at = doc.prefix.length;
	for (const child of doc.children) {
		starts.push(at + child.leadingTrivia.length);
		at += child.leadingTrivia.length + child.raw.length;
	}
	return starts;
}
