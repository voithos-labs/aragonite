/**
 * The list fix-up written into the editor's tree: each entry builds the fix-up's input from a body
 * and what the edit did, then splices the returned patch in with one `spliceList`. Every block the
 * patch made gets its own arrays and an undo stamp before it lands (`tree-operations/unshare.ts`).
 */

import type { CstNode, Document } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import type { LineEnding } from '../../core/lines';
import { documentLineEnding, trimTrailingLineEnding } from '../../core/lines';
import type { GrammarView } from '../../schema/block-openers';
import { dropChildSpans } from '../../schema/child-spans';
import { ensureEditableContainers } from '../../schema/opened-reading';
import { assignChildIdsDeep } from '../../block-id';
import { assertInvariant } from '@voithos-labs/aragonite/dev-checks';
import { recordSettlePass } from '../../perf/instruments';
import { checkStructuralDescriptor } from '../../invariants/structural-descriptor';
import { noteBodySettled } from '../../invariants/settle-once';
import { checkSettledWindowReadsBack } from '../../invariants/settled-window-reads-back';
import { checkSplicedOpenersClosed } from '../written-openers';
import type { SharingState } from '../sharing';
import { cloneMetadata } from '../clone';
import { spliceChildren } from '../children';
import { applyStructuralChangeToIdsRefs, type StructuralChange } from '../structural-change';
import { bodyUnder, spliceList, type BodyParent } from '../node-primitives';
import { editorHost } from './editor-host';
import {
	caretInBlocks,
	fixUpList,
	keepLastLineOpen,
	lastLineOpen,
	mergeJoins,
	withOneBlock
} from './index';
import type { ListEdit, ListResult, SiblingList } from './types';

export { caretInBlocks, lastLineOpen };

/** A caret the fix-up keeps on the same byte through every merge, written in place. */
export interface TrackedPosition {
	index: number;
	offset: number;
}

/** What an edit did to one body: its splice, the children before it, and a write, a move or a
 *  removal. */
export interface BodyEdit {
	change: StructuralChange;
	before: readonly CstNode[];
	written?: WrittenSlot;
	/** Where the moved block stands before the fix-up, and the lower block of the pair it left. */
	moved?: { to: number; uncovered: number | null };
	/** A block removed by `deleteNode`, on its own or after a join wrote it into the block above. */
	removed?: true;
}

/** What an edit did beyond its splice, which a mutation reports to the commit that fixes it up. */
export type EditKind = Pick<BodyEdit, 'written' | 'moved' | 'removed'>;

/** The edit's change widened by the fix-up, the write's own result, and where a moved block
 *  stands after it. */
export interface FixedUpEdit {
	change: StructuralChange;
	written: FixedUpWrite | null;
	moved: number | null;
}

/** A content write at `index`: the block as it stood before, and the bytes written into it. */
export interface WrittenSlot {
	index: number;
	previous: NodeView;
	text: string;
}

/** A content write once fixed up: its change widened by every merge, and where the written text
 *  starts inside that change's window (past the window head's own blank lines). */
export interface FixedUpWrite {
	change: StructuralChange;
	textStart: number;
}

// ── Entry points ─────────────────────────────────────────────────────────────

/** The fix-up a commit runs over each body it wrote. */
export function fixUpEdit(
	body: BodyParent,
	edit: BodyEdit,
	grammar: GrammarView,
	sharing: SharingState,
	tracked?: TrackedPosition
): FixedUpEdit {
	recordSettlePass();
	const { change, before } = edit;
	assertInvariant('structural-descriptor', () => checkStructuralDescriptor(change, before.length));
	const { written } = edit;
	checkSplicedOpeners(body, edit, grammar);
	const listEdit: ListEdit = {
		before,
		span: spanOf(change),
		...(written ? { written: { ...written, previous: written.previous as CstNode } } : {}),
		...(edit.moved ? { moved: edit.moved } : {}),
		...(edit.removed ? { removed: true as const } : {})
	};
	const result = fixUpList(listOf(body), listEdit, editorHost(grammar), tracked);
	const widened = writePatch(body, result, change, sharing, (i) => before[i]);
	if (tracked && result.caret) Object.assign(tracked, result.caret);
	checkReadsBack(body, widened, grammar);
	const start = written && (result.writtenStart ?? { index: written.index, offset: 0 });
	return {
		change: widened,
		written: start
			? { change: widened, textStart: offsetInWindow(body.children, widened, start) }
			: null,
		moved: result.movedTo ?? null
	};
}

/** A content write's fix-up, for a write no commit fixes up: the keystroke written in place, the
 *  trial before it, and a write into a body below the commit's scope. */
export function fixUpWrite(
	body: BodyParent,
	slot: WrittenSlot,
	change: StructuralChange,
	grammar: GrammarView,
	sharing: SharingState
): FixedUpWrite {
	recordSettlePass();
	noteBodySettled(body.children);
	const written = { ...slot, previous: slot.previous as CstNode };
	const span = spanOf(change);
	const result = fixUpList(listOf(body), { span, written }, editorHost(grammar));
	const shift = span ? span.added - span.removed : 0;
	// The live list: `before` reads it only inside `writePatch`, ahead of the splice.
	const given = body.children;
	const before = (i: number) =>
		i === slot.index ? written.previous : given[i < slot.index ? i : i + shift];
	const widened = writePatch(body, result, change, sharing, before);
	checkReadsBack(body, widened, grammar);
	const start = result.writtenStart ?? { index: slot.index, offset: 0 };
	return { change: widened, textStart: offsetInWindow(body.children, widened, start) };
}

/** A splice into a container found by walking the live tree, outside a commit's own list, and its
 *  fix-up; the owner's `childIds` stay in step. */
export function spliceFixedUp(
	parent: CstNode | Document,
	at: number,
	removeCount: number,
	replacement: CstNode[],
	grammar: GrammarView,
	sharing: SharingState,
	lineEnding: LineEnding
): void {
	const children = parent.children;
	if (!children || at < 0 || at > children.length) return;
	const before = children.slice();
	// `spliceChildren` writes `childIds` for its own splice, so the change below is the fix-up's.
	spliceChildren(parent as CstNode, at, removeCount, replacement);
	const removed = Math.min(removeCount, before.length - at);
	const change: StructuralChange = {
		op: 'replace',
		at,
		count: removed,
		newCount: replacement.length
	};
	const body = bodyUnder(parent, lineEnding);
	const edit: ListEdit = { before, span: spanOf(change), endingsFromBelow: true };
	const result = fixUpList(listOf(body), edit, editorHost(grammar));
	recordSettlePass();
	const merged = writePatch(body, result, { op: 'noop' }, sharing, (i) => body.children[i]);
	const ids = (parent as CstNode).childIds;
	if (ids) applyStructuralChangeToIdsRefs(merged, ids, new Array(ids.length));
}

/** Merges the blocks that read as one across the joins from the one above `at` to the one below
 *  the last of the `added` blocks from `at`, after a container's bytes or a split changed them. */
export function mergeJoinsAt(
	body: BodyParent,
	at: number,
	added: number,
	grammar: GrammarView,
	sharing: SharingState,
	tracked?: TrackedPosition,
	beforeWrite?: () => void
): StructuralChange {
	const result = mergeJoins(listOf(body), at, added, editorHost(grammar), tracked);
	if (result.removed === 0 && result.blocks.length === 0) return { op: 'noop' };
	beforeWrite?.();
	const merged = writePatch(body, result, { op: 'noop' }, sharing, (i) => body.children[i]);
	if (tracked && result.caret) Object.assign(tracked, result.caret);
	return merged;
}

/** When the document ended open before the commit, the block now last gives its ending up, unless
 *  its last line is blank. Run after the containers rebuild, since it writes each level's raw. */
export function keepOpenTail(
	doc: Document,
	wasOpen: boolean,
	sharing: SharingState,
	grammar: GrammarView
): void {
	const result = keepLastLineOpen(doc, wasOpen, editorHost(grammar));
	if (result.blocks.length > 0)
		spliceList(
			doc,
			result.at,
			result.removed,
			result.blocks.map((block) => adopt(block, sharing, documentLineEnding(doc)))
		);
}

/** The document always holds a block: a commit that leaves it none gives it one empty paragraph,
 *  and the change widens to cover it. */
export function keepOneBlock(
	body: BodyParent,
	change: StructuralChange,
	sharing: SharingState
): StructuralChange {
	const result = withOneBlock(listOf(body));
	if (result.blocks.length === 0) return change;
	spliceList(
		body,
		0,
		0,
		result.blocks.map((block) => adopt(block, sharing, body.lineEnding))
	);
	const removed = change.op === 'delete' || change.op === 'replace' ? change.count : 0;
	return removed === 0
		? { op: 'insert', at: 0, count: 1 }
		: { op: 'replace', at: 0, count: removed, newCount: 1 };
}

/** Whether the document's last line has no line ending; the commit reads it before the edit. */
export const endsOpen = (doc: Document): boolean => lastLineOpen(doc);

// ── Into the tree ────────────────────────────────────────────────────────────

function listOf(body: BodyParent): SiblingList {
	return {
		owner: body.owner,
		children: body.children,
		// The package reads a list's trailing lines from `suffix`, else from the owner.
		...(body.suffix !== undefined ? { suffix: body.suffix } : {}),
		lineEnding: body.lineEnding
	};
}

function spanOf(change: StructuralChange): ListEdit['span'] {
	switch (change.op) {
		case 'noop':
			return null;
		case 'insert':
			return { at: change.at, removed: 0, added: change.count };
		case 'delete':
			return { at: change.at, removed: change.count, added: 0 };
		case 'replace':
			return { at: change.at, removed: change.count, added: change.newCount, keeps: change.idMap };
	}
}

/**
 * Splices `result` into `body` and returns `change` (from the list before the edit, `before`
 * reading its blocks) widened over the patch, with the ids each block continues.
 */
function writePatch(
	body: BodyParent,
	result: ListResult,
	change: StructuralChange,
	sharing: SharingState,
	before: (index: number) => NodeView | undefined
): StructuralChange {
	const given = body.children;
	const touched = result.removed > 0 || result.blocks.length > 0;
	if ((writeSlots(body, result) || touched) && body.owner) dropChildSpans(body.owner);
	if (!touched) return change;
	const composed = composeChange(change, result, before, given);
	const placed = new Set(given.slice(result.at, result.at + result.removed));
	const blocks = result.blocks.map((block, i) => {
		const origin = given[result.keeps[i]];
		if (placed.has(block)) return block;
		if (placed.has(origin) && rewriteInPlace(origin, block, sharing, body.lineEnding))
			return origin;
		return adopt(block, sharing, body.lineEnding);
	});
	spliceList(body, result.at, result.removed, blocks);
	return composed;
}

/** Writes the list's own blank lines above and below its blocks; true when any changed. */
function writeSlots(body: BodyParent, result: ListResult): boolean {
	const { owner } = body;
	const trailing = result.suffix ?? result.innerSuffix ?? '';
	let changed = false;
	if (body.suffix !== undefined) {
		changed = body.suffix !== trailing;
		if (changed) body.suffix = trailing;
	} else if (owner && (owner.innerSuffix ?? '') !== trailing) {
		owner.innerSuffix = trailing;
		changed = true;
	}
	if (
		owner &&
		result.innerPrefix !== undefined &&
		(owner.innerPrefix ?? '') !== result.innerPrefix
	) {
		owner.innerPrefix = result.innerPrefix;
		changed = true;
	}
	return changed;
}

/** Writes a block the fix-up rewrote back into the node it continues when the tree owns that node,
 *  so the node another scope of the same commit holds is still the one in the tree. */
function rewriteInPlace(
	node: CstNode,
	next: CstNode,
	sharing: SharingState,
	ending: LineEnding
): boolean {
	if (sharing.isShared(node) || node.kind !== next.kind) return false;
	const children = node.children;
	if (next.children && next.children !== children) {
		if (!children || children.length !== next.children.length) return false;
		next.children.forEach((child, k) => {
			if (child === children[k] || rewriteInPlace(children[k], child, sharing, ending)) return;
			spliceList(node, k, 1, [adopt(child, sharing, ending)]);
		});
	}
	const rawChanged = node.raw !== next.raw;
	const fields = node as unknown as Record<string, unknown>;
	for (const [key, value] of Object.entries(next)) {
		if (key !== 'children' && fields[key] !== value) fields[key] = value;
	}
	// The spans place each child in the bytes they were laid out against, which the rewrite replaced.
	if (rawChanged) dropChildSpans(node);
	return true;
}

/** A block the patch made, with arrays of its own (a copy shares them with an undo entry's node),
 *  ids for a fresh reading's children, and the live tree's stamp. */
function adopt(block: CstNode, sharing: SharingState, ending: LineEnding): CstNode {
	const own = { ...block };
	if (block.children) own.children = [...block.children];
	if (block.childIds) own.childIds = [...block.childIds];
	if (block.childSpans) own.childSpans = block.childSpans.slice();
	if (block.metadata) own.metadata = cloneMetadata(block.metadata);
	if (own.children?.length && !own.childIds) {
		ensureEditableContainers(own, ending);
		assignChildIdsDeep(own);
	}
	sharing.stamp(own);
	return own;
}

/** `change` and the patch after it as one change from the list before the edit, each position
 *  keeping the id of the block it continues; a head read anew keeps its id only if its kind did. */
function composeChange(
	change: StructuralChange,
	result: ListResult,
	before: (index: number) => NodeView | undefined,
	given: readonly CstNode[]
): StructuralChange {
	const edit = spanOf(change) ?? { at: result.at, removed: 0, added: 0 };
	const added = result.blocks.length;
	const lo = Math.min(edit.at, result.at);
	const hi = Math.max(edit.at + edit.added, result.at + result.removed);
	const count = hi - lo - edit.added + edit.removed;
	const newCount = hi - lo + added - result.removed;
	const preEdit = (g: number): number | null => {
		if (g < edit.at) return g;
		if (g >= edit.at + edit.added) return g - edit.added + edit.removed;
		const kept = edit.keeps?.[g - edit.at];
		return kept === undefined ? null : edit.at + kept;
	};
	const continued = (f: number): number => {
		if (f < result.at) return f;
		if (f >= result.at + added) return f - added + result.removed;
		return result.keeps[f - result.at];
	};
	const idMap: Record<number, number> = {};
	for (let slot = 0; slot < newCount; slot++) {
		const g = continued(lo + slot);
		const p = g < 0 ? null : preEdit(g);
		if (p !== null && p >= lo && p < lo + count) idMap[slot] = p - lo;
	}
	const head = continued(lo);
	const block = result.blocks[lo - result.at];
	const reread =
		block &&
		head >= 0 &&
		trimTrailingLineEnding(block.raw) !== trimTrailingLineEnding(given[head].raw);
	// A head the edit made fresh and the fix-up read again keeps the id of the block it replaced,
	// unless the kind differs: a component must never stay mounted on a block of another kind.
	const fresh = idMap[0] === undefined && count > 0 && !Object.values(idMap).includes(0);
	if (fresh && reread && before(lo)?.kind === block.kind) idMap[0] = 0;
	const kept = Object.keys(idMap).length;
	const same =
		kept === count && count === newCount && Object.entries(idMap).every(([k, v]) => +k === v);
	if (same && change.op === 'noop') return change;
	if (count === 0) return { op: 'insert', at: lo, count: newCount };
	if (newCount === 0) return { op: 'delete', at: lo, count };
	return kept === 0
		? { op: 'replace', at: lo, count, newCount }
		: { op: 'replace', at: lo, count, newCount, idMap };
}

/** `start` as an offset in the window's text, where the head block's own blank lines are outside
 *  the window: the space every caret placement measures in. */
function offsetInWindow(
	children: readonly CstNode[],
	change: StructuralChange,
	start: { index: number; offset: number }
): number {
	const at = change.op === 'noop' ? start.index : change.at;
	let pos = 0;
	for (let i = at; i < start.index; i++) {
		pos += (i === at ? 0 : children[i].leadingTrivia.length) + children[i].raw.length;
	}
	return pos + (start.index > at ? children[start.index].leadingTrivia.length : 0) + start.offset;
}

/** G1.158 over the blocks a commit's edit put in place, asked against the bytes they replaced; a
 *  content write was made legal on its way in, and a removal puts nothing new. */
function checkSplicedOpeners(body: BodyParent, edit: BodyEdit, grammar: GrammarView): void {
	if (edit.written || edit.removed) return;
	const span = edit.moved ? { at: edit.moved.to, removed: 0, added: 1 } : spanOf(edit.change);
	if (!span) return;
	const replaced = edit.moved ? [] : edit.before.slice(span.at, span.at + span.removed);
	const before = replaced.map((node, k) => (k > 0 ? node.leadingTrivia : '') + node.raw).join('');
	assertInvariant('spliced-opener-closed', () =>
		checkSplicedOpenersClosed(body, span.at, span.added, before, grammar)
	);
}

/** G1.145 over the window a fix-up reports; a write that kept its block in place reports none,
 *  and a keystroke never pays for reading its neighbours again. */
function checkReadsBack(body: BodyParent, change: StructuralChange, grammar: GrammarView): void {
	const window = spanOf(change);
	if (!window) return;
	const hi = window.at + window.added - 1;
	assertInvariant('settled-window-reads-back', () =>
		checkSettledWindowReadsBack(body, window.at, hi, grammar)
	);
}
