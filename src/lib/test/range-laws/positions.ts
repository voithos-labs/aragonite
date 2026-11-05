// Where a leaf's text offset sits in a document's bytes, found with the parser alone: a marker
// character goes in at each byte, and a byte counts as the leaf offset the marker lands at when
// nothing else about the parse moved. The law checks read the bytes through this map, so none of
// them borrows the answer of the code it checks.

import type { CstNode, Document } from '#lib/core/nodes.js';
import { serialize } from '#lib/index.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import type { GrammarView } from '#lib/schema/block-openers.js';

const MARK = '';

/** A leaf offset as the map keys it: `path@offset`. */
export const pointKey = (path: readonly number[], offset: number) => `${path.join('.')}@${offset}`;

export const opened = (source: string, grammar: GrammarView): Document =>
	readAsOpened(source, { grammar, scope: 'document' });

/** Each text position of `source`, from `path@offset` to its byte. */
export function bytePositions(source: string, grammar: GrammarView): Map<string, number> {
	const base = layout(opened(source, grammar).children, []);
	const positions = new Map<string, number>();
	for (let at = 0; at <= source.length; at++) {
		// A marker between `\r` and `\n` would end a line with a lone `\r`.
		if (source[at - 1] === '\r' && source[at] === '\n') continue;
		const marked = layout(
			opened(source.slice(0, at) + MARK + source.slice(at), grammar).children,
			[]
		);
		const hit = markedLeaf(base, marked);
		if (hit) positions.set(pointKey(hit.path, hit.offset), at);
	}
	return positions;
}

/** The bytes a container's children make on their own, its markers gone. */
export function bodyOf(node: Document | CstNode): string {
	return serialize({ prefix: '', children: node.children ?? [], suffix: '' });
}

interface Laid {
	path: number[];
	kind: string;
	raw: string;
}

function layout(nodes: readonly CstNode[], prefix: number[]): Laid[] {
	return nodes.flatMap((node, i) => {
		const path = [...prefix, i];
		const own: Laid = { path, kind: node.kind, raw: node.children ? '' : node.raw };
		return node.children ? [own, ...layout(node.children, path)] : [own];
	});
}

/** The one leaf the marker landed in, when every node but that leaf's marker reads as before. */
function markedLeaf(base: Laid[], marked: Laid[]): { path: number[]; offset: number } | null {
	if (base.length !== marked.length) return null;
	let hit: { path: number[]; offset: number } | null = null;
	for (let i = 0; i < base.length; i++) {
		const a = base[i];
		const b = marked[i];
		if (a.kind !== b.kind || a.path.join() !== b.path.join()) return null;
		const offset = b.raw.indexOf(MARK);
		if (offset < 0) {
			if (a.raw !== b.raw) return null;
			continue;
		}
		if (hit || b.raw.replace(MARK, '') !== a.raw) return null;
		hit = { path: b.path, offset };
	}
	return hit;
}
