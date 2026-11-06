/** Lines of a container's own around its body (`<details>` … `</details>`), which bring their own
 *  writer so an app with no such container doesn't ship it. */

import type { CstNode } from '../core/nodes';
import { concatChildren } from '../core/serializer';
import { firstLineEnding, ownTrailingLineEnding, trimTrailingLineEnding } from '../core/lines';
import { WRITES_LINES, type FencedLines } from '../core/strip-lines';

/** A container with opening lines written from its data and title row (child 0), and a closing
 *  line; every line takes the opening line's ending, the closing one only where it had one. */
export function fencedLines<D>(write: FencedLines<D>['write']): FencedLines<D> {
	return { shape: 'fenced', write, [WRITES_LINES]: (node) => writeFenced(node, write) };
}

function writeFenced<D>(node: CstNode, write: FencedLines<D>['write']): void {
	const [row, ...body] = node.children!;
	const data = (node.metadata ?? {}) as D;
	const ending = firstLineEnding(node.raw) ?? '\n';
	const title = row ? trimTrailingLineEnding(row.raw) : '';
	const opening = write.open(data, title).map((line) => line + ending);
	const inner = (node.innerPrefix ?? '') + concatChildren(body) + (node.innerSuffix ?? '');
	const closer = write.close(data) + (ownTrailingLineEnding(node.raw) ? ending : '');
	node.raw = opening.join('') + inner + closer;
}
