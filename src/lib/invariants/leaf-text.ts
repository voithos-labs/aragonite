/** Every leaf's text in document order, whitespace aside, for the checks that compare a move's
 *  before and after: a marker renumbered or a line indented reads the same, a moved word doesn't. */

import type { NodeView } from '../core/node-views';

export function leafTexts(nodes: readonly NodeView[]): string[] {
	const texts: string[] = [];
	const walk = (node: NodeView) => {
		if (node.children) return node.children.forEach(walk);
		const text = node.raw.replace(/\s+/g, '');
		if (text) texts.push(text);
	};
	nodes.forEach(walk);
	return texts;
}

export function sameTexts(before: readonly string[], after: readonly string[]): boolean {
	return before.length === after.length && before.every((text, i) => text === after[i]);
}
