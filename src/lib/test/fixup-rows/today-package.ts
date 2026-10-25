// Today's fix-up behind the rebuilt package's entry points, built standalone so the bundle's
// checks can run against it: every recorded row must pass and every must-fix row must fail. It
// copies what it is handed and works on the copies, the way a commit hands the fix-up its own.

import type { CstNode, Document } from '#lib/core/nodes.js';
import { defaultGrammarView as grammar } from '#lib/schema/block-openers.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import type { StructuralChange } from '#lib/tree-operations/structural-change.js';
import type { BodyParent } from '#lib/tree-operations/node-primitives.js';
import { settleContentWrite, settleEdit } from '#lib/tree-operations/settle.js';
import {
	absorbWindowSeams,
	focusTargetInReplacement,
	type TrackedPosition
} from '#lib/tree-operations/neighbour-merge.js';
import { endsOpen, keepOpenTail } from '#lib/tree-operations/open-tail.js';
import { keepOneBlock } from '#lib/tree-operations/keep-one-block.js';

interface Span {
	at: number;
	removed: number;
	added: number;
	keeps?: Record<number, number>;
}
interface BlockList {
	owner?: CstNode;
	children: readonly CstNode[];
	suffix?: string;
	lineEnding: '\n' | '\r\n';
}
interface ListEdit {
	before?: readonly CstNode[];
	span: Span | null;
	written?: { index: number; previous: CstNode; text: string };
	moved?: { to: number; uncovered: number | null };
	removed?: true;
}
interface Caret {
	index: number;
	offset: number;
}
interface ListResult {
	at: number;
	removed: number;
	blocks: CstNode[];
	keeps: number[];
	innerPrefix?: string;
	innerSuffix?: string;
	suffix?: string;
	caret?: Caret;
	writtenStart?: Caret;
	movedTo?: number;
}

// ── Copies ───────────────────────────────────────────────────────────────────

const PUBLISHED = new Set([
	'kind',
	'leadingTrivia',
	'raw',
	'metadata',
	'innerPrefix',
	'children',
	'innerSuffix'
]);

/** A node in published shape, without the editor's caches. */
function plain(node: CstNode): CstNode {
	const out: Record<string, unknown> = {};
	for (const key of Object.keys(node)) {
		if (!PUBLISHED.has(key)) continue;
		const value = (node as unknown as Record<string, unknown>)[key];
		if (key === 'children') out.children = (value as CstNode[]).map(plain);
		else if (key === 'metadata') out.metadata = structuredClone(value);
		else out[key] = value;
	}
	return out as unknown as CstNode;
}

/** Copies the top-level nodes once each, so two positions holding one block still do. */
function copier() {
	const copies = new Map<CstNode, CstNode>();
	return (node: CstNode): CstNode => {
		let copy = copies.get(node);
		if (!copy) {
			copy = structuredClone(plain(node));
			copies.set(node, copy);
		}
		return copy;
	};
}

interface Body extends BodyParent {
	suffix?: string;
}

function bodyOf(list: BlockList, copy: (node: CstNode) => CstNode): Body {
	const children = list.children.map(copy);
	if (!list.owner)
		return { children, owner: undefined, lineEnding: list.lineEnding, suffix: list.suffix ?? '' };
	const owner = {
		...structuredClone(plain({ ...list.owner, children: [] } as CstNode)),
		children
	} as CstNode;
	return { children, owner, lineEnding: list.lineEnding };
}

// ── The result as a patch ────────────────────────────────────────────────────

const same = (a: CstNode, b: CstNode) => JSON.stringify(plain(a)) === JSON.stringify(plain(b));

/** The narrowest window of `given` the call changed, against the copies it worked on. */
function patchOf(given: readonly CstNode[], copies: readonly CstNode[], after: readonly CstNode[]) {
	let head = 0;
	while (
		head < given.length &&
		head < after.length &&
		after[head] === copies[head] &&
		same(after[head], given[head])
	)
		head++;
	let tail = 0;
	while (
		tail < given.length - head &&
		tail < after.length - head &&
		after[after.length - 1 - tail] === copies[given.length - 1 - tail] &&
		same(after[after.length - 1 - tail], given[given.length - 1 - tail])
	) {
		tail++;
	}
	return {
		at: head,
		removed: given.length - head - tail,
		blocks: after.slice(head, after.length - tail).map(plain)
	};
}

function applyIds(change: StructuralChange, ids: number[], fresh: () => number): number[] {
	const out = [...ids];
	if (change.op === 'insert')
		out.splice(change.at, 0, ...Array.from({ length: change.count }, fresh));
	else if (change.op === 'delete') out.splice(change.at, change.count);
	else if (change.op === 'replace') {
		const old = out.slice(change.at, change.at + change.count);
		const map = change.idMap ?? {};
		out.splice(
			change.at,
			change.count,
			...Array.from({ length: change.newCount }, (_, i) =>
				map[i] !== undefined ? old[map[i]] : fresh()
			)
		);
	}
	return out;
}

/** For each block after the call, the position in the list as given whose block it continues;
 *  today's result counts from the list before the edit, so ids come back through the edit's span. */
function continuations(
	beforeLength: number,
	span: Span | null,
	result: StructuralChange
): number[] {
	let next = beforeLength;
	const before = Array.from({ length: beforeLength }, (_, i) => i);
	const fromBefore = new Map<number, number>();
	const givenLength = beforeLength + (span ? span.added - span.removed : 0);
	for (let j = 0; j < givenLength; j++) {
		const b = beforeOf(j, span);
		if (b >= 0) fromBefore.set(b, j);
	}
	return applyIds(result, before, () => next++).map((id) => fromBefore.get(id) ?? -1);
}

/** The block of the list before the edit that position `j` of the list as given continues. */
export function beforeOf(j: number, span: Span | null): number {
	if (!span || j < span.at) return j;
	if (j >= span.at + span.added) return j - span.added + span.removed;
	const kept = span.keeps?.[j - span.at];
	return kept === undefined ? -1 : span.at + kept;
}

function changeOf(span: Span | null): StructuralChange {
	if (!span) return { op: 'noop' };
	if (span.removed === 0) return { op: 'insert', at: span.at, count: span.added };
	if (span.added === 0) return { op: 'delete', at: span.at, count: span.removed };
	return {
		op: 'replace',
		at: span.at,
		count: span.removed,
		newCount: span.added,
		...(span.keeps ? { idMap: span.keeps } : {})
	};
}

function result(
	list: BlockList,
	copies: CstNode[],
	body: Body,
	keepsAll: number[] | null,
	extra: Partial<ListResult>
): ListResult {
	const patch = patchOf(list.children, copies, body.children);
	const keeps = keepsAll
		? keepsAll.slice(patch.at, patch.at + patch.blocks.length)
		: patch.blocks.map((block, i) =>
				body.children[patch.at + i] === copies[patch.at + i] ? patch.at + i : -1
			);
	const slots = body.owner
		? { innerPrefix: body.owner.innerPrefix ?? '', innerSuffix: body.owner.innerSuffix ?? '' }
		: { suffix: body.suffix ?? '' };
	return { ...patch, keeps, ...slots, ...extra };
}

// ── Entry points ─────────────────────────────────────────────────────────────

export function fixUpList(
	list: BlockList,
	edit: ListEdit,
	_host: unknown,
	caret?: Caret
): ListResult {
	const copy = copier();
	const body = bodyOf(list, copy);
	const copies = [...body.children];
	const sharing = createSharingState();
	const change = changeOf(edit.span);
	if (!edit.before && edit.written) {
		const settled = settleContentWrite(
			body,
			{ index: edit.written.index, previous: copy(edit.written.previous), text: edit.written.text },
			change,
			grammar,
			sharing
		);
		const beforeLength = list.children.length - (edit.span?.added ?? 0) + (edit.span?.removed ?? 0);
		return result(list, copies, body, continuations(beforeLength, edit.span, settled.change), {
			writtenStart: startOf(body.children, settled, edit.written.index)
		});
	}
	const tracked: TrackedPosition | undefined = caret ? { ...caret } : undefined;
	const before = (edit.before ?? []).map(copy);
	const settled = settleEdit(
		body,
		{
			change,
			before,
			...(edit.written
				? {
						written: {
							index: edit.written.index,
							previous: copy(edit.written.previous),
							text: edit.written.text
						}
					}
				: {}),
			...(edit.moved ? { moved: edit.moved } : {}),
			...(edit.removed ? { removed: true as const } : {})
		},
		grammar,
		sharing,
		tracked
	);
	return result(list, copies, body, continuations(before.length, edit.span, settled.change), {
		...(tracked ? { caret: { ...tracked } } : {}),
		...(settled.written && edit.written
			? { writtenStart: startOf(body.children, settled.written, edit.written.index) }
			: {}),
		...(settled.moved !== null ? { movedTo: settled.moved } : {})
	});
}

export function mergeJoins(
	list: BlockList,
	at: number,
	added: number,
	_host: unknown,
	caret?: Caret
): ListResult {
	const copy = copier();
	const body = bodyOf(list, copy);
	const copies = [...body.children];
	const tracked: TrackedPosition | undefined = caret ? { ...caret } : undefined;
	const settled = absorbWindowSeams(
		body,
		at,
		added,
		at,
		{ op: 'noop' },
		grammar,
		createSharingState(),
		tracked
	);
	return result(
		list,
		copies,
		body,
		continuations(list.children.length, null, settled.change),
		tracked ? { caret: { ...tracked } } : {}
	);
}

export function lastLineOpen(document: Document): boolean {
	return endsOpen(document);
}

export function keepLastLineOpen(document: Document, wasOpen: boolean): ListResult {
	const copy = copier();
	const copies = document.children.map(copy);
	const doc: Document = { ...document, children: [...copies] };
	keepOpenTail(doc, wasOpen, createSharingState(), grammar);
	const list: BlockList = {
		children: document.children,
		suffix: document.suffix,
		lineEnding: '\n'
	};
	return result(
		list,
		copies,
		{ children: doc.children, owner: undefined, lineEnding: '\n', suffix: doc.suffix },
		null,
		{}
	);
}

export function withOneBlock(list: BlockList): ListResult {
	const copy = copier();
	const body = bodyOf(list, copy);
	const copies = [...body.children];
	keepOneBlock(body, { op: 'noop' }, createSharingState());
	return result(list, copies, body, null, {});
}

export function caretInBlocks(blocks: readonly CstNode[], offset: number): Caret {
	return focusTargetInReplacement(blocks, offset);
}

/** Where the written text starts, from the offset today's write reports inside its window. */
function startOf(
	children: readonly CstNode[],
	settled: { change: StructuralChange; textStart: number },
	index: number
): Caret {
	const at = settled.change.op === 'noop' ? index : settled.change.at;
	let offset = settled.textStart;
	let i = at;
	// Walks forward from the window's head, as the caret placement does from the same offset.
	while (i < children.length - 1) {
		const rawLength = children[i].raw.length;
		const next = children[i + 1];
		if (offset < rawLength + next.leadingTrivia.length) break;
		offset -= rawLength + next.leadingTrivia.length;
		i++;
	}
	return { index: i, offset };
}
