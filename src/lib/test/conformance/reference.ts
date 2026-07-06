/**
 * commonmark.js is the conformance reference. Exact-pinned: the committed
 * baseline is only meaningful against this version — bumping it is a
 * deliberate re-bless with a changelog note.
 */
import { Parser, Node } from 'commonmark';

export const REFERENCE_VERSION = '0.31.2';

const parser = new Parser();

export function referenceInlineNodes(markdown: string): Node[] | null {
	const doc = parser.parse(markdown);
	const first = doc.firstChild;
	if (!first || first.type !== 'paragraph' || first.next) return null;
	const nodes: Node[] = [];
	for (let child = first.firstChild; child; child = child.next) nodes.push(child);
	return nodes;
}
