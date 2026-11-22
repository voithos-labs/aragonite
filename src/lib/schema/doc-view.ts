/**
 * The document as a plugin reads it: a `Doc` of `Block`s, each with its type, its data, its bytes
 * and its text, read-only, with every position in document bytes. What `editor.doc`, `blockAt`, a
 * block type's `draw` and a paint hand a plugin. Nothing is computed until it's read, and a node
 * reads as one `Block` for as long as the document holds it.
 */
import { getPluginMetadata, type AnyBlockKind, type InlineNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { getContentRange, isProseKind } from '../core/inline';
import { isReservedChromeChild, rowContentRange } from './reserved-chrome';
import type { BlockType } from './plugin-unit';
import { makingOf } from './block-type';
import { recordBlockBuilt } from '../perf/instruments';

// ── Public API ───────────────────────────────────────────────────────────────

/** One version of the document's bytes and the blocks it holds. Once a write or a load replaces
 *  the version, `current` turns false: `text` and `eol` stay that version's, while `blocks`,
 *  `walk` and `blockAt` read the document as it stands, so read `editor.doc` again after an
 *  `await`. */
export interface Doc {
	readonly text: string;
	/** The ending a line written into it takes: its first line break's, else LF. */
	readonly eol: '\n' | '\r\n';
	/** Its top-level blocks, each built when read. */
	readonly blocks: readonly Block[];
	readonly current: boolean;
	/** The deepest block holding document byte `at` (a list item's paragraph, a table cell): a
	 *  marker's byte goes to the text on its line. Null outside the document. */
	blockAt(at: number): Block | null;
	/** Every block, depth first, each built when reached; a title row comes after its container. */
	walk(): IterableIterator<Block>;
}

/** One block of the document. */
export interface Block<D = unknown> {
	readonly type: BlockType<D>;
	readonly data: D;
	/** Its bytes, its line ending included. In a quote or a list item these leave out the markers
	 *  between its lines, so `byteAt` finds where one of them sits in the document. */
	readonly text: string;
	/** The text the author writes in it, its markers left out. */
	readonly body: string;
	/** The blocks it holds, each built when read; a title row is `title`, not a child. */
	readonly children: readonly Block[];
	/** The block holding it; null at the top level, or once it has left the document. */
	readonly parent: Block | null;
	/** Where it sits among its parent's children or the document's blocks; -1 for a title row,
	 *  and where it isn't placed. */
	readonly index: number;
	/** Whether its text reads as inline Markdown (a paragraph, a heading, a cell). */
	readonly prose: boolean;
	/** Its title row's title (`<summary>`, `:::note Title`) and where it sits; null for a block
	 *  with no title row. */
	readonly title: { readonly text: string; readonly from: number; readonly to: number } | null;
	/** Its bytes in the document, read when asked (an edit above moves them with no `update`).
	 *  Both -1 means not placed (a key typed in it can do that): ask the document again. */
	readonly from: number;
	readonly to: number;
	/** Its inline content (code spans, links, emphasis, text), in document bytes; empty for a
	 *  block whose text isn't inline Markdown. */
	readonly pieces: readonly Piece[];
	/** The document byte offset `offset` of `text` sits at; -1 where it isn't placed. */
	byteAt(offset: number): number;
	/** The offset into `text` document byte `at` sits at; null where `at` isn't its text (another
	 *  block, or a container's marker between its lines). */
	offsetAt(at: number): number | null;
	/** Narrows the block to `type`'s data. */
	is<E>(type: BlockType<E>): this is Block<E>;
	/** Whether it's of `type` where that's one of several (`builtin.blocks[kind]`), not narrowed. */
	is(type: BlockType<unknown>): boolean;
	/** It and every block inside it, depth first, a title row right after its container. */
	walk(): IterableIterator<Block>;
}

/** An inline construct's type: one of `builtin.inlines`, or a plugin's. */
export interface InlineType<D = unknown> {
	readonly name: string;
	readonly '~data'?: D;
}

/** One piece of a block's inline content. */
export interface Piece<D = unknown> {
	/** What it is: `text`, `inlineCode`, `link`, `emphasis` and the other built-ins, or a
	 *  plugin's construct. */
	readonly kind: string;
	readonly from: number;
	readonly to: number;
	/** Its bytes as the block reads them. A `text` piece holds at most one line, so its character
	 *  `i` sits at document byte `from + i`. */
	readonly text: string;
	/** What its type reads from its bytes; undefined for a built-in. */
	readonly data: D;
	readonly children: readonly Piece[];
	/** Narrows the piece to `type`'s data. */
	is<E>(type: InlineType<E>): this is Piece<E>;
}

// ── What a block reads through ───────────────────────────────────────────────

/** Where a block's node was last seen: its path, and the document version it was seen at. */
export interface Seen {
	path: readonly number[] | null;
	at: number;
	/** The version a dev build last checked a moved read at. */
	checked?: number;
}

/** What a block reads through: one editor's document, a parsed one, or none. */
export interface BlockReading {
	typeOf(kind: AnyBlockKind): BlockType<unknown>;
	/** The block of `node`, the same one for as long as it's the document's; `path` is where the
	 *  caller sees it now, at version `at`. */
	blockOf(node: NodeView, path: readonly number[] | null, at?: number): Block;
	/** Where `node` stands now, moved on from `seen`; null once it has left the document. */
	find(node: NodeView, seen: Seen): readonly number[] | null;
	nodeAt(path: readonly number[]): NodeView | null;
	/** Offset `offset` of the bytes of the block at `path`, as a document byte. */
	byteOf(path: readonly number[], offset: number): number | null;
	/** Past the bytes of the block at `path`: past its line ending, or at its text where its
	 *  container closes the line (a summary's tag). */
	ownEnd(path: readonly number[]): number | null;
	inline(node: NodeView): readonly InlineNode[];
	/** The document version now: a block's pieces are read again once it moves on. */
	version(): number;
}

/** What a surface's `depends(block)` answers for each top-level block, kept across writes. */
export interface KeyWatch {
	/** Moves on whenever an answer that says something comes, goes, changes or stands at another
	 *  index; a reader compares it with the one it last saw. */
	version(): number;
	/** One answer per top-level block, in order; an array handed out is never changed after. */
	keys(): readonly string[];
}

/** A block read outside any editor: types named by their kinds, no positions, no pieces. */
export const DETACHED_READING: BlockReading = {
	typeOf: (kind) => ({ name: kind, label: kind }),
	blockOf: (node) => makeBlock(node, DETACHED_READING, null),
	find: () => null,
	nodeAt: () => null,
	byteOf: () => null,
	ownEnd: () => null,
	inline: () => [],
	version: () => 0
};

/** `node` as a plugin reads it, made by the reading that keeps its blocks. */
export function makeBlock<D>(
	node: NodeView,
	reading: BlockReading,
	path: readonly number[] | null,
	at = reading.version()
): Block<D> {
	return new NodeBlock(node, reading, path, at) as unknown as Block<D>;
}

/** The node a block was read from, which a draft finds again in the document it commits to. */
export function nodeOfBlock(block: Block<unknown>): NodeView | undefined {
	return block instanceof NodeBlock ? block[STATE].node : undefined;
}

/** Where `block`'s node stands now; null once it has left the document. */
export function pathOfBlock(block: Block<unknown>): readonly number[] | null {
	return block instanceof NodeBlock ? pathOf(block[STATE]) : null;
}

/** Tells `block` where its node stands now, as a caller holding the path sees it. */
export function seenAt(block: Block<unknown>, path: readonly number[] | null, at?: number): void {
	if (!(block instanceof NodeBlock) || !path) return;
	const state = block[STATE];
	state.path = path;
	state.at = at ?? state.reading.version();
}

/** A read-only array whose element `i` is made by `at(i)` when read, over a length read live. */
export function lazyList<T>(length: () => number, at: (index: number) => T): readonly T[] {
	const index = (key: string | symbol): number | null => {
		if (typeof key !== 'string') return null;
		const n = Number(key);
		return Number.isInteger(n) && n >= 0 && String(n) === key ? n : null;
	};
	return new Proxy([] as T[], {
		get(target, key, receiver) {
			if (key === 'length') return length();
			const i = index(key);
			if (i === null) return Reflect.get(target, key, receiver);
			return i < length() ? at(i) : undefined;
		},
		has(target, key) {
			const i = index(key);
			return i === null ? Reflect.has(target, key) : i < length();
		},
		ownKeys: () => [...Array.from({ length: length() }, (_, i) => String(i)), 'length'],
		getOwnPropertyDescriptor(target, key) {
			if (key === 'length')
				return { ...Reflect.getOwnPropertyDescriptor(target, key), value: length() };
			const i = index(key);
			if (i === null || i >= length()) return Reflect.getOwnPropertyDescriptor(target, key);
			return { value: at(i), writable: false, enumerable: true, configurable: true };
		},
		set: () => false,
		deleteProperty: () => false,
		defineProperty: () => false
	});
}

// ── Internal ─────────────────────────────────────────────────────────────────

// Under a symbol, so a wrapper that reads through to a block (`Object.create`, a `Proxy`) reads it.
const STATE = Symbol('Block.state');

interface BlockState extends Seen {
	readonly node: NodeView;
	readonly reading: BlockReading;
	type?: { kind: AnyBlockKind; type: BlockType<unknown> };
	children?: readonly Block[];
	pieces?: { at: number; pieces: readonly Piece[] };
}

// Its reads sit on the prototype, so a walk of a large document makes one small object per block.
class NodeBlock {
	readonly [STATE]: BlockState;

	constructor(node: NodeView, reading: BlockReading, path: readonly number[] | null, at: number) {
		this[STATE] = { node, reading, path, at };
		// Frozen, so a framework's reactive state (Vue's `ref`) holds the block itself, not a proxy.
		Object.freeze(this);
		recordBlockBuilt();
	}

	get type(): BlockType<unknown> {
		const state = this[STATE];
		const { kind } = state.node;
		if (state.type?.kind !== kind) state.type = { kind, type: state.reading.typeOf(kind) };
		return state.type.type;
	}

	get data(): unknown {
		return getPluginMetadata(this[STATE].node);
	}

	get text(): string {
		return this[STATE].node.raw;
	}

	get body(): string {
		const { node } = this[STATE];
		const { start, end } = (makingOf(this.type)?.bodyRange ?? getContentRange)(node);
		return node.raw.slice(start, end);
	}

	get children(): readonly Block[] {
		const state = this[STATE];
		return (state.children ??= lazyList(
			() => Math.max(0, (state.node.children?.length ?? 0) - titled(state.node)),
			(i) => {
				const at = i + titled(state.node);
				const path = pathOf(state);
				return state.reading.blockOf(state.node.children![at], path && [...path, at]);
			}
		));
	}

	get parent(): Block | null {
		const state = this[STATE];
		const path = pathOf(state);
		if (!path || path.length < 2) return null;
		const up = path.slice(0, -1);
		const node = state.reading.nodeAt(up);
		return node ? state.reading.blockOf(node, up) : null;
	}

	get index(): number {
		const state = this[STATE];
		const path = pathOf(state);
		if (!path) return -1;
		const last = path[path.length - 1];
		const up = path.length > 1 ? state.reading.nodeAt(path.slice(0, -1)) : null;
		return up && isReservedChromeChild(up, 0) ? last - 1 : last;
	}

	get prose(): boolean {
		return isProseKind(this[STATE].node.kind);
	}

	get title(): Block['title'] {
		const state = this[STATE];
		const row = titled(state.node) ? state.node.children![0] : null;
		if (!row) return null;
		const { start, end } = rowContentRange(state.node, row);
		const path = pathOf(state);
		const rowPath = path && [...path, 0];
		const place = (offset: number) => (rowPath ? state.reading.byteOf(rowPath, offset) : null);
		return { text: row.raw.slice(start, end), ...spanOf(place, start, end) };
	}

	get from(): number {
		return this.byteAt(0);
	}

	get to(): number {
		const state = this[STATE];
		const path = pathOf(state);
		return (path && state.reading.ownEnd(path)) ?? -1;
	}

	get pieces(): readonly Piece[] {
		const state = this[STATE];
		const at = state.reading.version();
		if (state.pieces?.at === at) return state.pieces.pieces;
		const path = pathOf(state);
		const place = (offset: number) => (path ? state.reading.byteOf(path, offset) : null);
		const pieces = path ? piecesOf(state.node.raw, state.reading.inline(state.node), place) : [];
		state.pieces = { at, pieces };
		return pieces;
	}

	byteAt(offset: number): number {
		const state = this[STATE];
		const path = pathOf(state);
		return (path && state.reading.byteOf(path, offset)) ?? -1;
	}

	offsetAt(at: number): number | null {
		const state = this[STATE];
		const path = pathOf(state);
		if (!path) return null;
		return offsetOf((offset) => state.reading.byteOf(path, offset), state.node.raw.length, at);
	}

	is(other: BlockType<unknown>): boolean {
		return other.name === this.type.name;
	}

	walk(): IterableIterator<Block> {
		return walkFrom([this as unknown as Block]);
	}
}

const pathOf = (state: BlockState) => state.reading.find(state.node, state);

// A title row is child 0 and stands outside `children`.
const titled = (node: NodeView): number =>
	node.children?.length && isReservedChromeChild(node, 0) ? 1 : 0;

/** `blocks` and everything inside them, depth first, a title row (its container's child 0) right
 *  after its container. */
export function* walkFrom(blocks: Iterable<Block>): Generator<Block> {
	for (const block of blocks) {
		yield block;
		// A leaf asks nothing: a document of small blocks walks at the cost of reading them.
		if (block instanceof NodeBlock && block[STATE].node.children?.length)
			yield* inside(block[STATE]);
	}
}

// Off the nodes, each path in hand and the version read once, so no block asks where its parent
// stands.
function* inside(state: BlockState): Generator<Block> {
	const { reading } = state;
	const at = reading.version();
	const nodes: NodeView[] = [];
	const paths: (readonly number[] | null)[] = [];
	const push = (node: NodeView, path: readonly number[] | null) => {
		const children = node.children ?? [];
		for (let i = children.length - 1; i >= 0; i--) {
			nodes.push(children[i]);
			paths.push(path && [...path, i]);
		}
	};
	push(state.node, pathOf(state));
	while (nodes.length > 0) {
		const node = nodes.pop()!;
		const path = paths.pop()!;
		yield reading.blockOf(node, path, at);
		push(node, path);
	}
}

/** Offsets `[start, end)` of a block's bytes in document bytes, both -1 where they aren't placed. */
function spanOf(
	place: (offset: number) => number | null,
	start: number,
	end: number
): { from: number; to: number } {
	const from = place(start) ?? -1;
	// Past its last byte, not at the next offset's: that one can sit beyond a container's marker.
	const last = end > start ? place(end - 1) : null;
	return { from, to: end > start ? (last === null ? -1 : last + 1) : from };
}

// A text node crossing a line ending is cut after it: inside a container the next line's bytes
// start past a marker, so only a one-line piece is a plain run of document bytes.
function piecesOf(
	raw: string,
	nodes: readonly InlineNode[],
	place: (offset: number) => number | null
): Piece[] {
	const out: Piece[] = [];
	for (const node of nodes) {
		if (node.kind !== 'text') {
			out.push(
				pieceOf(node.kind, raw, node.start, node.end, place, node.children ?? [], node.data)
			);
			continue;
		}
		let start = node.start;
		while (start < node.end) {
			const lineEnd = raw.indexOf('\n', start);
			const end = lineEnd < 0 || lineEnd + 1 > node.end ? node.end : lineEnd + 1;
			out.push(pieceOf('text', raw, start, end, place, []));
			start = end;
		}
	}
	return out;
}

function pieceOf(
	kind: string,
	raw: string,
	start: number,
	end: number,
	place: (offset: number) => number | null,
	children: readonly InlineNode[],
	data?: unknown
): Piece {
	let read: readonly Piece[] | undefined;
	return {
		kind,
		...spanOf(place, start, end),
		text: raw.slice(start, end),
		data,
		get children() {
			return (read ??= piecesOf(raw, children, place));
		},
		is: (type: InlineType<unknown>): boolean => type.name === kind
	} as Piece;
}

// The map is monotonic, so the last offset at or before `at` is found by halving.
function offsetOf(
	place: (offset: number) => number | null,
	length: number,
	at: number
): number | null {
	let lo = 0;
	let hi = length;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if ((place(mid) ?? Infinity) <= at) lo = mid;
		else hi = mid - 1;
	}
	return place(lo) === at ? lo : null;
}
