// Wraps the exports of the commit's fix-up steps so each outermost call is written down: what it
// was handed and what it left, in published node shapes only. An edit's calls are kept only when
// the edit as a whole came out right, so no row pins a known defect.

import { createHash } from 'node:crypto';
import type { CstNode, Document } from '#lib/core/nodes.js';
import type { StructuralChange } from '#lib/tree-operations/structural-change.js';

export interface FixupRow {
	entry: string;
	/** The function today's editor called, which a mapping to the entry can disagree with. */
	via: string;
	pool: unknown[];
	args: Record<string, unknown>;
	expect: Record<string, unknown>;
}

/** A row past this many bytes holds a long list, which adds length, not a new shape. */
const ROW_BYTES = 8000;

let depth = 0;
let pending: FixupRow[] = [];
const seen = new Set<string>();
let sink: ((line: string) => void) | null = null;

let name: string | undefined;

/** Where kept rows go, one JSON line each, as soon as their edit ends; rows seen so far count
 *  as new again. */
export function writeRowsTo(write: (line: string) => void): void {
	sink = write;
	seen.clear();
	shapes.clear();
	shapeCap = Infinity;
}

/** Starts an edit, named when its rows are a named example: calls from here on wait for
 *  {@link endEdit}. */
export function beginEdit(label?: string): void {
	pending = [];
	name = label;
}

/** Ends an edit, keeping its calls only when it came out right; a row seen before is dropped. */
export function endEdit(ok: boolean): void {
	if (ok && sink) {
		for (const row of pending) {
			const line = JSON.stringify(name ? { name, ...row } : row);
			if (line.length > ROW_BYTES) continue;
			const key = createHash('sha1')
				.update(row.via + JSON.stringify([row.pool, row.args]))
				.digest('base64');
			if (seen.has(key)) continue;
			seen.add(key);
			const shape = shapeOf(row);
			const count = shapes.get(shape) ?? 0;
			if (count >= shapeCap) continue;
			shapes.set(shape, count + 1);
			sink(line);
		}
	}
	pending = [];
}

export const rowCount = (): number => seen.size;

const shapes = new Map<string, number>();
let shapeCap = Infinity;

/** Keeps at most `cap` rows of each shape from here on, so a run of documents that differ only in
 *  their text adds coverage, not bulk. */
export function capRowsPerShape(cap: number): void {
	shapeCap = cap;
}

/** A row's shape: the entry, how today's editor reached it, the edit's kind and the kinds of the
 *  blocks it was handed. */
function shapeOf(row: FixupRow): string {
	const args = row.args as {
		list?: { owner?: { kind: string }; children: number[] };
		edit?: Record<string, unknown>;
	};
	const kinds = (args.list?.children ?? []).map((i) => (row.pool[i] as { kind: string }).kind);
	const edit = args.edit
		? Object.keys(args.edit)
				.filter((key) => args.edit![key] != null)
				.join('+')
		: '';
	return [row.via, args.list?.owner?.kind ?? 'document', edit, kinds.join(',')].join(' ');
}

// ── Node shapes ──────────────────────────────────────────────────────────────

/** A node as the published shape spells it: the fields a reload reads, never the editor's caches. */
export function plainNode(node: CstNode): Record<string, unknown> {
	const out: Record<string, unknown> = {
		kind: node.kind,
		leadingTrivia: node.leadingTrivia,
		raw: node.raw
	};
	if (node.metadata !== undefined) out.metadata = JSON.parse(JSON.stringify(node.metadata));
	if (node.innerPrefix !== undefined) out.innerPrefix = node.innerPrefix;
	if (node.children) out.children = node.children.map(plainNode);
	if (node.innerSuffix !== undefined) out.innerSuffix = node.innerSuffix;
	return out;
}

/** An owner without its children, which are the list itself. */
function plainOwner(owner: CstNode): Record<string, unknown> {
	const { children: _children, ...rest } = plainNode(owner);
	return rest;
}

/** Top-level nodes by identity, so a row says which positions hold the same block. */
function createPool() {
	const nodes: unknown[] = [];
	const index = new Map<CstNode, number>();
	return {
		nodes,
		ref(node: CstNode): number {
			let at = index.get(node);
			if (at === undefined) {
				at = nodes.length;
				index.set(node, at);
				nodes.push(plainNode(node));
			}
			return at;
		}
	};
}

interface BodyLike {
	children: CstNode[];
	owner?: CstNode;
	lineEnding: string;
	suffix?: string;
}

function listArgs(body: BodyLike, pool: ReturnType<typeof createPool>) {
	return {
		...(body.owner ? { owner: plainOwner(body.owner) } : {}),
		children: body.children.map((node) => pool.ref(node)),
		...(body.owner ? {} : { suffix: body.suffix ?? '' }),
		lineEnding: body.lineEnding
	};
}

function listAfter(body: BodyLike) {
	return {
		children: body.children.map(plainNode),
		...(body.owner
			? { innerPrefix: body.owner.innerPrefix ?? '', innerSuffix: body.owner.innerSuffix ?? '' }
			: { suffix: body.suffix ?? '' })
	};
}

/** A position in a list as an offset into the list's own bytes, which no window convention moves. */
export function byteOffset(children: readonly CstNode[], index: number, offset: number): number {
	let at = 0;
	for (let i = 0; i < index && i < children.length; i++) {
		at += children[i].leadingTrivia.length + children[i].raw.length;
	}
	return at + (children[index]?.leadingTrivia.length ?? 0) + offset;
}

// ── Which block continues which ──────────────────────────────────────────────

/** Ids the way the editor moves them through a change: kept where the change maps a slot back. */
function applyChange(change: StructuralChange, ids: number[], fresh: () => number): number[] {
	const out = [...ids];
	switch (change.op) {
		case 'noop':
			return out;
		case 'insert':
			out.splice(change.at, 0, ...Array.from({ length: change.count }, fresh));
			return out;
		case 'delete':
			out.splice(change.at, change.count);
			return out;
		case 'replace': {
			const old = out.slice(change.at, change.at + change.count);
			const map = change.idMap ?? {};
			const next = Array.from({ length: change.newCount }, (_, i) =>
				map[i] !== undefined ? old[map[i]] : fresh()
			);
			out.splice(change.at, change.count, ...next);
			return out;
		}
	}
}

/** For each block after the call, the block of the list before the edit it continues, or -1:
 *  ids moved through the result's change the way the editor moves them. */
function continuations(beforeLength: number, result: StructuralChange): number[] {
	let next = beforeLength;
	const before = Array.from({ length: beforeLength }, (_, i) => i);
	return applyChange(result, before, () => next++).map((id) => (id < beforeLength ? id : -1));
}

// ── The wrappers ─────────────────────────────────────────────────────────────

type Fn = (...args: never[]) => unknown;

/** Calls `fn` and records it when it is the outermost wrapped call. */
function outermost<F extends Fn>(
	fn: F,
	record: (args: Parameters<F>, run: () => ReturnType<F>) => ReturnType<F>
): F {
	return ((...args: Parameters<F>) => {
		if (depth > 0) return fn(...args);
		depth++;
		try {
			return record(args, () => fn(...args) as ReturnType<F>);
		} finally {
			depth--;
		}
	}) as F;
}

const caretOf = (
	children: readonly CstNode[],
	tracked: { index: number; offset: number } | undefined
) => (tracked ? byteOffset(children, tracked.index, tracked.offset) : null);

export function wrapSettle<M extends Record<string, Fn>>(mod: M): M {
	const settleEdit = outermost(mod.settleEdit as Fn, (args, run) => {
		const [body, edit, , , tracked] = args as unknown as [
			BodyLike,
			{
				change: StructuralChange;
				before: readonly CstNode[];
				written?: { index: number; previous: CstNode; text: string };
				moved?: { to: number; uncovered: number | null };
				removed?: true;
			},
			unknown,
			unknown,
			{ index: number; offset: number } | undefined
		];
		const pool = createPool();
		const list = listArgs(body, pool);
		const before = edit.before.map((node) => pool.ref(node));
		const span = spanOf(edit.change);
		const caretIn = tracked ? { ...tracked } : undefined;
		const written = edit.written && {
			index: edit.written.index,
			previous: pool.ref(edit.written.previous),
			text: edit.written.text
		};
		const result = run() as {
			change: StructuralChange;
			written: { textStart: number; change: StructuralChange } | null;
			moved: number | null;
		};
		const keeps = continuations(edit.before.length, result.change);
		pending.push({
			entry: 'fixUpList',
			via: 'settleEdit',
			pool: pool.nodes,
			args: {
				list,
				edit: {
					before,
					span,
					...(written ? { written } : {}),
					...(edit.moved ? { moved: edit.moved } : {}),
					...(edit.removed ? { removed: true } : {})
				},
				...(caretIn ? { caret: caretIn } : {})
			},
			expect: {
				...listAfter(body),
				keeps,
				caret: caretOf(body.children, tracked),
				caretBlock: tracked?.index ?? null,
				writtenStart: result.written
					? writtenStart(body.children, result.written, edit.written!.index)
					: null,
				movedTo: result.moved
			}
		});
		return result as never;
	});
	const settleContentWrite = outermost(mod.settleContentWrite as Fn, (args, run) => {
		const [body, slot, change] = args as unknown as [
			BodyLike,
			{ index: number; previous: CstNode; text: string },
			StructuralChange
		];
		const pool = createPool();
		const list = listArgs(body, pool);
		const written = { index: slot.index, previous: pool.ref(slot.previous), text: slot.text };
		const beforeLength = body.children.length - placedBy(change) + removedBy(change);
		const result = run() as { change: StructuralChange; textStart: number };
		pending.push({
			entry: 'fixUpList',
			via: 'settleContentWrite',
			pool: pool.nodes,
			args: { list, edit: { span: spanOf(change), written } },
			expect: {
				...listAfter(body),
				keeps: continuations(beforeLength, result.change),
				caret: null,
				caretBlock: null,
				writtenStart: writtenStart(body.children, result, slot.index),
				movedTo: null
			}
		});
		return result as never;
	});
	const spliceChildrenSettled = outermost(mod.spliceChildrenSettled as Fn, (args, run) => {
		const [parent, at, removeCount, replacement, , , lineEnding] = args as unknown as [
			{ children?: CstNode[]; kind: string } & Partial<Document>,
			number,
			number,
			CstNode[],
			unknown,
			unknown,
			string
		];
		const children = parent.children ?? [];
		const isDoc = parent.kind === 'document';
		const owner = isDoc ? undefined : (parent as unknown as CstNode);
		const pool = createPool();
		const before = children.map((node) => pool.ref(node));
		const afterSplice = [
			...children.slice(0, at),
			...replacement,
			...children.slice(at + removeCount)
		];
		const body: BodyLike = {
			children: afterSplice,
			owner,
			lineEnding,
			suffix: isDoc ? (parent as Document).suffix : undefined
		};
		const list = listArgs(body, pool);
		const result = run();
		const live: BodyLike = {
			children: parent.children ?? [],
			owner,
			lineEnding,
			suffix: isDoc ? (parent as Document).suffix : undefined
		};
		pending.push({
			entry: 'fixUpList',
			via: 'spliceChildrenSettled',
			pool: pool.nodes,
			args: {
				list,
				edit: { before, span: { at, removed: removeCount, added: replacement.length } }
			},
			expect: {
				...listAfter(live),
				keeps: null,
				caret: null,
				caretBlock: null,
				writtenStart: null,
				movedTo: null
			}
		});
		return result as never;
	});
	return { ...mod, settleEdit, settleContentWrite, spliceChildrenSettled };
}

export function wrapMerge<M extends Record<string, Fn>>(mod: M): M {
	const absorbWindowSeams = outermost(mod.absorbWindowSeams as Fn, (args, run) => {
		const [body, at, added, , change, , , tracked] = args as unknown as [
			BodyLike,
			number,
			number,
			number,
			StructuralChange,
			unknown,
			unknown,
			{ index: number; offset: number } | undefined
		];
		if (change.op !== 'noop') return run();
		const pool = createPool();
		const list = listArgs(body, pool);
		const length = body.children.length;
		const caretIn = tracked ? { ...tracked } : undefined;
		const result = run() as { change: StructuralChange };
		pending.push({
			entry: 'mergeJoins',
			via: 'absorbWindowSeams',
			pool: pool.nodes,
			args: { list, at, added, ...(caretIn ? { caret: caretIn } : {}) },
			expect: {
				...listAfter(body),
				keeps: continuations(length, result.change),
				caret: caretOf(body.children, tracked),
				caretBlock: tracked?.index ?? null
			}
		});
		return result as never;
	});
	const absorbSeamReading = outermost(mod.absorbSeamReading as Fn, (args, run) => {
		const [body, seamLeft, floor, , , tracked] = args as unknown as [
			BodyLike,
			number,
			number,
			unknown,
			unknown,
			{ index: number; offset: number } | undefined
		];
		const pool = createPool();
		const list = listArgs(body, pool);
		const caretIn = tracked ? { ...tracked } : undefined;
		const result = run() as { at: number; span: number; eaten: number; spliced: boolean };
		const keeps = body.children.map((_, i) =>
			!result.spliced || i < result.at
				? i
				: i >= result.at + result.span
					? i + result.eaten
					: i === result.at
						? i
						: -1
		);
		pending.push({
			entry: 'mergeJoins',
			via: 'absorbSeamReading',
			pool: pool.nodes,
			args: { list, at: seamLeft + 1, added: 0, floor, ...(caretIn ? { caret: caretIn } : {}) },
			expect: {
				...listAfter(body),
				keeps,
				caret: caretOf(body.children, tracked),
				caretBlock: tracked?.index ?? null
			}
		});
		return result as never;
	});
	const focusTargetInReplacement = outermost(mod.focusTargetInReplacement as Fn, (args, run) => {
		const [nodes, offset] = args as unknown as [readonly CstNode[], number];
		const pool = createPool();
		const blocks = nodes.map((node) => pool.ref(node as CstNode));
		const result = run() as { index: number; offset: number };
		pending.push({
			entry: 'caretInBlocks',
			via: 'focusTargetInReplacement',
			pool: pool.nodes,
			args: { blocks, offset },
			expect: { ...result }
		});
		return result as never;
	});
	return { ...mod, absorbWindowSeams, absorbSeamReading, focusTargetInReplacement };
}

export function wrapOpenTail<M extends Record<string, Fn>>(mod: M): M {
	const docArgs = (doc: Document, pool: ReturnType<typeof createPool>) => ({
		prefix: doc.prefix,
		children: doc.children.map((node) => pool.ref(node)),
		suffix: doc.suffix
	});
	const endsOpen = outermost(mod.endsOpen as Fn, (args, run) => {
		const [doc] = args as unknown as [Document];
		const pool = createPool();
		const document = docArgs(doc, pool);
		const result = run() as boolean;
		pending.push({
			entry: 'lastLineOpen',
			via: 'endsOpen',
			pool: pool.nodes,
			args: { document },
			expect: { open: result }
		});
		return result as never;
	});
	const keepOpenTail = outermost(mod.keepOpenTail as Fn, (args, run) => {
		const [doc, wasOpen] = args as unknown as [Document, boolean];
		const pool = createPool();
		const document = docArgs(doc, pool);
		const result = run();
		pending.push({
			entry: 'keepLastLineOpen',
			via: 'keepOpenTail',
			pool: pool.nodes,
			args: { document, wasOpen },
			expect: { children: doc.children.map(plainNode), suffix: doc.suffix }
		});
		return result as never;
	});
	return { ...mod, endsOpen, keepOpenTail };
}

export function wrapKeepOneBlock<M extends Record<string, Fn>>(mod: M): M {
	const keepOneBlock = outermost(mod.keepOneBlock as Fn, (args, run) => {
		const [body] = args as unknown as [BodyLike];
		const pool = createPool();
		const list = listArgs(body, pool);
		const result = run();
		pending.push({
			entry: 'withOneBlock',
			via: 'keepOneBlock',
			pool: pool.nodes,
			args: { list },
			expect: listAfter(body)
		});
		return result as never;
	});
	return { ...mod, keepOneBlock };
}

// ── Small reads off a change ─────────────────────────────────────────────────

function spanOf(
	change: StructuralChange
): { at: number; removed: number; added: number; keeps?: Record<number, number> } | null {
	switch (change.op) {
		case 'noop':
			return null;
		case 'insert':
			return { at: change.at, removed: 0, added: change.count };
		case 'delete':
			return { at: change.at, removed: change.count, added: 0 };
		case 'replace':
			return {
				at: change.at,
				removed: change.count,
				added: change.newCount,
				...(change.idMap ? { keeps: { ...change.idMap } } : {})
			};
	}
}

const placedBy = (change: StructuralChange): number =>
	change.op === 'insert' ? change.count : change.op === 'replace' ? change.newCount : 0;
const removedBy = (change: StructuralChange): number =>
	change.op === 'delete' || change.op === 'replace' ? change.count : 0;

/** Where the written text starts once the call ran, from the offset today's write reports inside
 *  its change's window (the window's head block's own leading lines left out). */
function writtenStart(
	children: readonly CstNode[],
	settled: { change: StructuralChange; textStart: number },
	index: number
): number {
	const at = settled.change.op === 'noop' ? index : settled.change.at;
	return byteOffset(children, at, 0) + settled.textStart;
}
