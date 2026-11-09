/**
 * A block as a plugin reads it: its type, its data, its bytes and its text, read-only, with every
 * position in document bytes. What a block type's `draw`, `height` and commands, a paint and
 * `blockAt` hand a plugin. Nothing is computed until it's read.
 */
import { getPluginMetadata, type AnyBlockKind, type InlineNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { getContentRange } from '../core/inline';
import type { BlockType } from './plugin-unit';
import { makingOf } from './block-type';

/** One block of the document. */
export interface Block<D = unknown> {
	readonly type: BlockType<D>;
	readonly data: D;
	/** Its bytes, its line ending included. In a quote or a list item these leave out the markers
	 *  between its lines, so `byteAt` finds where one of them sits in the document. */
	readonly text: string;
	/** The text the author writes in it, its markers left out. */
	readonly body: string;
	readonly children: readonly Block[];
	/** Its bytes in the document, read when asked (an edit above moves them with no `update`);
	 *  both -1 once it has left the document, which a draft refuses. */
	readonly from: number;
	readonly to: number;
	/** Its inline content (code spans, links, emphasis, text), in document bytes; empty for a
	 *  block whose text isn't inline Markdown. */
	readonly pieces: readonly Piece[];
	/** The document byte offset `offset` of `text` sits at; -1 once it has left the document. */
	byteAt(offset: number): number;
	/** The offset into `text` document byte `at` sits at; null where `at` isn't its text (another
	 *  block, or a container's marker between its lines). */
	offsetAt(at: number): number | null;
	/** Narrows the block to `type`'s data. */
	is<E>(type: BlockType<E>): this is Block<E>;
}

/** An inline construct's type: one of `builtin.inlines`, or a plugin's. */
export interface InlineType {
	readonly name: string;
}

/** One piece of a block's inline content. */
export interface Piece {
	/** What it is: `text`, `inlineCode`, `link`, `emphasis` and the other built-ins, or a
	 *  plugin's construct. */
	readonly kind: string;
	readonly from: number;
	readonly to: number;
	/** Its bytes as the block reads them. A `text` piece holds at most one line, so its character
	 *  `i` sits at document byte `from + i`. */
	readonly text: string;
	readonly children: readonly Piece[];
	is(type: InlineType): boolean;
}

/** What a block view reads through: each kind's block type, where a node's bytes sit in the
 *  document now, and its inline content. */
export interface BlockReading {
	typeOf(kind: AnyBlockKind): BlockType<unknown>;
	/** Maps an offset of `node.raw` to its document byte; null once `node` has left the document.
	 *  `path` is where it was last seen, tried before a search. */
	place(node: NodeView, path?: readonly number[]): ((offset: number) => number | null) | null;
	inline(node: NodeView): readonly InlineNode[];
}

/** A block read outside any editor: types named by their kinds, no positions, no pieces. */
export const DETACHED_READING: BlockReading = {
	typeOf: (kind) => ({ name: kind, label: kind }),
	place: () => null,
	inline: () => []
};

/** `node` as a plugin reads it, through `reading`. */
export function blockOf<D>(
	node: NodeView,
	reading: BlockReading,
	path?: readonly number[]
): Block<D> {
	const type = reading.typeOf(node.kind) as BlockType<D>;
	let children: readonly Block[] | undefined;
	let pieces: readonly Piece[] | undefined;
	const byteAt = (offset: number) => reading.place(node, path)?.(offset) ?? -1;
	return {
		[NODE]: node,
		type,
		data: getPluginMetadata<D>(node) as D,
		text: node.raw,
		get body() {
			const { start, end } = (makingOf(type)?.bodyRange ?? getContentRange)(node);
			return node.raw.slice(start, end);
		},
		get children() {
			return (children ??= (node.children ?? []).map((child, i) =>
				blockOf(child, reading, path && [...path, i])
			));
		},
		get from() {
			return byteAt(0);
		},
		get to() {
			return byteAt(node.raw.length);
		},
		get pieces() {
			if (pieces) return pieces;
			const place = reading.place(node, path);
			return (pieces = place ? piecesOf(node.raw, reading.inline(node), place) : []);
		},
		byteAt,
		offsetAt(at: number) {
			const place = reading.place(node, path);
			return place ? offsetOf(place, node.raw.length, at) : null;
		},
		is: <E>(other: BlockType<E>): boolean => other.name === type.name
	} as unknown as Block<D>;
}

/** The node a block was read from, which a draft finds again in the document it commits to. */
export function nodeOfBlock(block: Block<unknown>): NodeView | undefined {
	return (block as { [NODE]?: NodeView })[NODE];
}

const NODE = Symbol('Block.node');

// ── Internal ─────────────────────────────────────────────────────────────────

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
			out.push(pieceOf(node.kind, raw, node.start, node.end, place, node.children ?? []));
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
	children: readonly InlineNode[]
): Piece {
	let read: readonly Piece[] | undefined;
	const from = place(start) ?? -1;
	// Past its last byte, not at the next offset's: that one can sit beyond a container's marker.
	const last = end > start ? place(end - 1) : null;
	return {
		kind,
		from,
		to: end > start ? (last === null ? -1 : last + 1) : from,
		text: raw.slice(start, end),
		get children() {
			return (read ??= piecesOf(raw, children, place));
		},
		is: (type: InlineType) => type.name === kind
	};
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
