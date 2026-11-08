/**
 * Where the blocks of a parsed document sit in its bytes: each block's span, a text block's text
 * inside its own markers, each container line's marker, and the two-way map between a byte and a
 * text position. Read off the document's byte map (`tree-operations/container-offsets.ts`), one
 * block at a time as a gesture asks, so a range edit's work stays near its range.
 */

import type { DocumentView, NodeView } from '../core/node-views';
import { getContentRange } from '../core/inline';
import { blockNodeAt } from '../tree-operations/node-primitives';
import {
	childTriviaStart,
	containerLines,
	documentByteMap
} from '../tree-operations/container-offsets';

export interface LaidLine {
	from: number;
	/** Where the container's marker on the line ends; `from` on a line with none. */
	markerTo: number;
	/** Past the line's ending. */
	to: number;
	/** The line holds none of the container's children: a line that opens or closes it, a title. */
	own: boolean;
}

export interface LaidBlock {
	path: number[];
	type: string;
	/** Where its leading blank lines start. */
	start: number;
	/** Its own bytes, through its last line's ending. */
	from: number;
	to: number;
	/** A block without children: where its text sits, inside its own markers. */
	text?: { from: number; to: number };
	/** A container whose children sit on lines of its own; its `lines` are read when asked. */
	container: boolean;
	readonly lines?: LaidLine[];
}

export interface Layout {
	/** The block at `path`; undefined for the document itself or a path that names nothing. */
	block(path: readonly number[]): LaidBlock | undefined;
	/** Every block whose bytes reach `[from, to]`, ends included, parents before children. */
	within(from: number, to: number): Iterable<LaidBlock>;
	/** The byte offset `offset` of the text block at `path` sits at; null for any other path. */
	byteOf(path: readonly number[], offset: number): number | null;
	/** The text position at `byte`, or null where the byte belongs to no text (a marker, a closer). */
	pointAt(byte: number): { path: number[]; offset: number } | null;
}

/** Reads nothing until asked, so a layout made ahead of its first question costs nothing. */
export function documentLayout(doc: DocumentView): Layout {
	const map = documentByteMap(doc);
	const laid = new Map<string, LaidBlock>();
	let tops: { start: number; raw: string }[] | undefined;
	const topAt = (i: number) => {
		if (!tops) {
			tops = [];
			let at = doc.prefix.length;
			for (let j = 0; j < doc.children.length; j++) {
				const node = doc.children[j];
				tops.push({ start: at, raw: node.raw });
				at += node.leadingTrivia.length + node.raw.length;
			}
		}
		return tops[i];
	};
	const rawStart = (i: number) => topAt(i).start + doc.children[i].leadingTrivia.length;
	// A block's last line runs to the end of its line in the source, past a title's closing tag too.
	const pastLine = (path: readonly number[], raw: string, end: number): number => {
		if (!raw.endsWith('\n', end)) return map.byteOf(path, end)!;
		const top = path[0];
		const byte = map.byteOf(path, end - (raw.endsWith('\r\n', end) ? 2 : 1))!;
		return rawStart(top) + topAt(top).raw.indexOf('\n', byte - rawStart(top)) + 1;
	};
	const leaf = (path: readonly number[]): NodeView | null => {
		const node = blockNodeAt(doc, path);
		return node && childless(node) ? node : null;
	};

	function block(path: readonly number[]): LaidBlock | undefined {
		const key = path.join();
		const known = laid.get(key);
		if (known || path.length === 0) return known;
		const node = blockNodeAt(doc, path);
		if (!node) return undefined;
		const parentPath = path.slice(0, -1);
		const parent = parentPath.length > 0 ? blockNodeAt(doc, parentPath) : null;
		const parentMap = parent && map.containerMap(parent);
		const index = path[path.length - 1];
		const start = !parent
			? topAt(index).start
			: parentMap
				? map.byteOf(parentPath, childTriviaStart(parentMap, parent, index))!
				: 0;
		const own = map.containerMap(node);
		const laidBlock: LaidBlock = {
			path: path.slice(),
			type: node.kind,
			start,
			from: map.byteOf(path, 0)!,
			to: pastLine(path, node.raw, node.raw.length),
			container: own !== null && 'rawLines' in own
		};
		if (childless(node)) {
			const text = getContentRange(node);
			laidBlock.text = { from: map.byteOf(path, text.start)!, to: map.byteOf(path, text.end)! };
		} else if (laidBlock.container) {
			let lines: LaidLine[] | undefined;
			Object.defineProperty(laidBlock, 'lines', {
				get: () =>
					(lines ??= (containerLines(own!) ?? []).map((line) => ({
						from: map.byteOf(path, line.start)!,
						markerTo: line.own
							? pastLine(path, node.raw, line.end)
							: map.byteOf(path, line.markerEnd)!,
						to: pastLine(path, node.raw, line.end),
						own: line.own
					})))
			});
		}
		laid.set(key, laidBlock);
		return laidBlock;
	}

	/** Children `[first, count)` of the block at `path`, those reaching `[from, to]`, in order. */
	function* reaching(
		path: number[],
		count: number,
		from: number,
		to: number
	): Generator<LaidBlock> {
		const at = (i: number) => block([...path, i])!;
		// The first child whose bytes run to `from`; children lie in order, so the rest follow it.
		let lo = 0;
		let hi = count;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (at(mid).to < from) lo = mid + 1;
			else hi = mid;
		}
		for (let i = lo; i < count; i++) {
			const child = at(i);
			if (child.from > to) return;
			yield child;
			const children = blockNodeAt(doc, child.path)!.children;
			if (children) yield* reaching(child.path, children.length, from, to);
		}
	}

	return {
		block,
		within: (from, to) => reaching([], doc.children.length, from, to),
		byteOf(path, offset) {
			const node = leaf(path);
			return node && offset >= 0 && offset <= node.raw.length ? map.byteOf(path, offset) : null;
		},
		pointAt(byte) {
			const point = map.leafAt(byte);
			return point && leaf(point.path) && map.byteOf(point.path, point.offset) === byte
				? point
				: null;
		}
	};
}

// A diagram's parse gives it an empty children array; the byte map reads it as text all the same.
const childless = (node: NodeView) => !node.children?.length;
