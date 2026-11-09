/**
 * The byte splice: the commit for an edit that decided its bytes before touching the tree. It makes
 * the byte changes, plus a closing line under any opener they write that a block below would close,
 * reads the top-level blocks they reach again, and lands the caret at a byte of the new bytes. No
 * list fix-up or open-tail step runs (`docs/design/commit-and-undo.md` § The byte splice).
 */

import type { CstNode } from '../../core/nodes';
import type { DocumentView, NodeView } from '../../core/node-views';
import type { Landing } from '../../selection/primitives';
import type { BlockComponent } from '../../block-component';
import type { SourceSplice, SpliceCaret } from '../../action-contracts';
import { serialize } from '../../core/serializer';
import { docPathFrom } from '../../core/coordinate-spaces';
import { spliceMany } from '../../tree-operations/splice-many';
import {
	spliceReading,
	type SpliceReading,
	type SpliceWindow
} from '../../tree-operations/byte-splice';
import type { ByteChange } from '../../tree-operations/byte-changes';
import {
	applyStructuralChangeToIdsRefs,
	replacePreservingFirst,
	stampOwned,
	type StructuralChange
} from '../../tree-operations/structural-change';
import { byteOfLeaf, documentByteMap, leafAtByte } from '../../tree-operations/container-offsets';
import { readCurrentSelection } from '../../selection/native-bridge';
import type { BlockReach } from './change-record';
import {
	gapEligibleAt,
	type GapCaretPosition,
	type GapCaretSelection
} from '../../selection/gap-caret';
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
		const was = { ...deps.doc };
		const before = serialize(was);
		const read = spliceReading(was, before, splice.changes, grammar);
		const closers = read ? splicedOpenerClosers(was, before, splice.changes, read, grammar) : [];
		const changes =
			closers.length > 0 ? withSplicedClosers(before, splice.changes, closers) : splice.changes;
		const reading = closers.length > 0 ? spliceReading(was, before, changes, grammar) : read;
		const windows = reading?.windows ?? [];
		// Measured in the caller's bytes, then past the closers, so a caret inside a write stays in front.
		const named = splice.caret === 'keep' ? caretKept(deps, splice.changes, windows) : splice.caret;
		const caret = named && { ...named, at: offsetPastClosers(named.at, closers) };
		let saved: { children: CstNode[]; ids: string[]; refs: (BlockComponent | undefined)[] } | null =
			null;
		let replaced: ReplacedBlocks = 'unknown';
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
				replaced = installReading(deps, reading);
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
			check: () => {
				assertSpliceReadsBack(deps.doc.children, placed(windows), grammar);
				if (reading)
					assertInvariant('spliced-opener-closed', () =>
						checkSplicedChangesClosed(was, before, changes, reading, grammar)
					);
			},
			rollback: () => {
				if (!saved) return;
				deps.doc.children = saved.children;
				deps.setBlockIds(saved.ids);
				replaceRefs(deps.blockRefs, saved.refs);
			},
			landing: () => caret && landingAt(deps.doc, caret),
			reveal: splice.reveal
		});
	};
}

/** The live document's top-level blocks read again as `reading` says, ids and refs moved with
 *  them; blocks outside its windows keep their nodes. Returns the blocks it replaced. */
export function installReading(deps: EditorActionsDeps, reading: SpliceReading): ReplacedBlocks {
	const replaced = replacedBy(deps.doc.children, reading.windows);
	// Off the tree's `$state` proxy, where every index a splice shifts is a tracked write.
	const children = [...deps.doc.children];
	const ids = [...deps.blockIds];
	const refs = [...deps.blockRefs];
	// Last window first, so each one's indices still hold.
	for (const window of [...reading.windows].reverse()) {
		spliceMany(children, window.at, window.count, window.blocks);
		const change = changeOf(window);
		// The reading gave its blocks their ids, so a window holding a long container's kept
		// children walks none of them.
		stampOwned(children, change, deps.sharing);
		applyStructuralChangeToIdsRefs(change, ids, refs);
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
	const map = documentByteMap(doc);
	const tops = topLevelStarts(doc);
	let found: GapCaretPosition | null = null;
	let parentPath: number[] = [];
	let children = doc.children;
	let startOf = (k: number) => tops[k];
	// A child starting at or past `at`, or holding it; inside a container, the map's answer alone.
	let near = tops.findIndex((start) => start >= at);
	if (near < 0) near = children.length - 1;
	let end = serialize(doc).length;
	for (;;) {
		const index = at === end ? children.length : startOf(near) === at ? near : -1;
		if (index >= 0 && gapEligibleAt(doc, parentPath, index)) found = { parentPath, index };
		// The last child starting at or before `at`.
		let i = near;
		while (i + 1 < children.length && startOf(i + 1) <= at) i++;
		if (i > 0 && startOf(i) > at) i--;
		const child = children[i];
		const inner = child?.children?.length ? map.containerMap(child) : null;
		if (!inner) return found;
		const base = startOf(i);
		end = base + child.raw.length;
		parentPath = [...parentPath, i];
		children = child.children!;
		startOf = (k) => base + inner.rawOf(k, 0);
		near = inner.childAt(at - base).index;
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
