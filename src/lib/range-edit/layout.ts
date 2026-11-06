/**
 * Where every block of a parsed document sits in its bytes: each block's span, a text block's text
 * inside its own markers, each container line's marker, and the two-way map between a byte and a
 * text position. Read off the document's byte map (`tree-operations/container-offsets.ts`).
 */

import type { DocumentView, NodeView } from '../core/node-views';
import { getContentRange } from '../core/inline';
import { documentByteMap } from '../tree-operations/container-offsets';

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
	/** A container: its lines. */
	lines?: LaidLine[];
}

export interface Layout {
	/** Every block, depth first, parents before children. */
	blocks: LaidBlock[];
	/** The byte offset `offset` of the text block at `path` sits at; null for any other path. */
	byteOf(path: readonly number[], offset: number): number | null;
	/** The text position at `byte`, or null where the byte belongs to no text (a marker, a closer). */
	pointAt(byte: number): { path: number[]; offset: number } | null;
}

export function documentLayout(doc: DocumentView): Layout {
	const map = documentByteMap(doc);
	const blocks: LaidBlock[] = [];
	const leaves = new Map<string, NodeView>();
	const tops: { start: number; raw: string }[] = [];
	// A block's last line runs to the end of its line in the source, past a title's closing tag too.
	const pastLine = (path: readonly number[], raw: string, end: number): number => {
		if (!raw.endsWith('\n', end)) return map.byteOf(path, end)!;
		const top = tops[path[0]];
		const at = map.byteOf(path, end - (raw.endsWith('\r\n', end) ? 2 : 1))! - top.start;
		return top.start + top.raw.indexOf('\n', at) + 1;
	};
	const lay = (node: NodeView, path: number[], start: number) => {
		const block: LaidBlock = {
			path,
			type: node.kind,
			start,
			from: map.byteOf(path, 0)!,
			to: pastLine(path, node.raw, node.raw.length)
		};
		blocks.push(block);
		if (!node.children) {
			const text = getContentRange(node);
			block.text = { from: map.byteOf(path, text.start)!, to: map.byteOf(path, text.end)! };
			leaves.set(path.join(), node);
			return;
		}
		const lines = map.lines(path);
		if (lines) {
			block.lines = lines.map((line) => ({
				from: map.byteOf(path, line.start)!,
				markerTo: line.own ? pastLine(path, node.raw, line.end) : map.byteOf(path, line.markerEnd)!,
				to: pastLine(path, node.raw, line.end),
				own: line.own
			}));
		}
		node.children.forEach((child, i) => {
			const trivia = map.triviaStart(path, i);
			lay(child, [...path, i], trivia === null ? 0 : map.byteOf(path, trivia)!);
		});
	};
	let at = doc.prefix.length;
	doc.children.forEach((node, i) => {
		tops.push({ start: at + node.leadingTrivia.length, raw: node.raw });
		lay(node, [i], at);
		at += node.leadingTrivia.length + node.raw.length;
	});
	return {
		blocks,
		byteOf(path, offset) {
			const leaf = leaves.get(path.join());
			return leaf && offset >= 0 && offset <= leaf.raw.length ? map.byteOf(path, offset) : null;
		},
		pointAt(byte) {
			const point = map.leafAt(byte);
			return point && leaves.has(point.path.join()) && map.byteOf(point.path, point.offset) === byte
				? point
				: null;
		}
	};
}
