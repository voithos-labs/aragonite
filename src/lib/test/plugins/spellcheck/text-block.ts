// A text block shaped like the one the editor's `blockAt` returns, built from the editor's own
// inline parse, so the spell check's rows read real pieces before the editor hands them out.
import { parseInline, type InlineNode } from '#lib';
import type { Editor } from '#lib/plugin.js';
import type { Piece, TextBlock } from '#packages/spellcheck/src/words.js';

/** `raw` parsed as one block whose text starts at document byte `from`. With `marker`, each line
 *  after the first sits behind it in the document, as a quote's lines sit behind `> `. */
export function textBlock(raw: string, from = 0, marker = ''): TextBlock {
	const lineStarts = [...raw.matchAll(/\n/g)].map((m) => m.index + 1);
	const byteAt = (offset: number) =>
		from + offset + marker.length * lineStarts.filter((start) => start <= offset).length;
	const offsetAt = (byte: number) => {
		let offset = byte - from;
		while (offset > 0 && byteAt(offset) > byte) offset--;
		return offset;
	};
	const piece = (node: InlineNode): Piece => ({
		kind: node.kind,
		from: byteAt(node.start),
		to: byteAt(node.end),
		text: raw.slice(node.start, node.end),
		children: (node.children ?? []).map(piece)
	});
	return { text: raw, pieces: parseInline(raw, 0, raw.length).map(piece), byteAt, offsetAt };
}

/** An editor whose `blockAt` answers with `blocks`, each over its own bytes. */
export function readingEditor(
	blocks: TextBlock[],
	edit: () => ReturnType<Editor['edit']> = () => {
		throw new Error('no edit expected');
	}
): Editor {
	const blockAt = (at: number) =>
		blocks.find((b) => b.byteAt(0) <= at && at <= b.byteAt(b.text.length)) ?? null;
	return { blockAt, edit } as unknown as Editor;
}
