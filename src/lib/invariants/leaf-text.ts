/** Every leaf's text in document order, whitespace aside, for the checks that compare a move's
 *  before and after: a marker renumbered, a line indented or a fence lengthened reads the same, a
 *  moved word doesn't. */

import type { NodeView } from '../core/node-views';
import { tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';

export function leafTexts(nodes: readonly NodeView[]): string[] {
	const texts: string[] = [];
	const walk = (node: NodeView) => {
		if (node.children) return node.children.forEach(walk);
		const text = textOf(node);
		if (text) texts.push(text);
	};
	nodes.forEach(walk);
	return texts;
}

/** The leaf text before `from` and after `to`, each run together, with both nodes and everything
 *  between them left out; with either one missing, the whole text and nothing. */
export function leafTextAround(
	nodes: readonly NodeView[],
	from: NodeView | null,
	to: NodeView | null
): [before: string, after: string] {
	if (!from || !to) return [leafTexts(nodes).join(''), ''];
	const texts: [string, string] = ['', ''];
	let side: 0 | 'between' | 1 = 0;
	const walk = (node: NodeView) => {
		if (node === from) side = 'between';
		if (node === to) return void (side = 1);
		if (node.children) return node.children.forEach(walk);
		if (side !== 'between') texts[side] += textOf(node);
	};
	nodes.forEach(walk);
	return texts;
}

/** A leaf's text as its kind reads it: its write rule's text, else its content span. */
function textOf(node: NodeView): string {
	const descriptor = tryGetBlockKindDescriptor(node.kind);
	const span = descriptor?.getContentRange?.(node);
	const text =
		descriptor?.rawWrite?.text?.(node.raw) ??
		(span ? node.raw.slice(span.start, span.end) : node.raw);
	return text.replace(/\s+/g, '');
}

export function sameTexts(before: readonly string[], after: readonly string[]): boolean {
	return before.length === after.length && before.every((text, i) => text === after[i]);
}
