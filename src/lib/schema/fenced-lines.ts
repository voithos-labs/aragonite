/** Lines of a container's own around its body (`<details>` … `</details>`), which bring their own
 *  reader and writer so an app with no such container ships neither. */

import type { CstNode } from '../core/nodes';
import { concatChildren } from '../core/serializer';
import { firstLineEnding, ownTrailingLineEnding, trimTrailingLineEnding } from '../core/lines';
import { READS_LINES, WRITES_LINES, type FencedLines } from '../core/strip-lines';
import { fencedReading, type FencedSpec } from './fence-shape';

/** A container's own lines around its body: only the lines `write` and `close.write` spell open
 *  and close it, and `escape` takes an unpaired body line `open` or `close.match` reads. */
export function fencedLines<D extends object>(spec: FencedSpec<D>): FencedLines<D> {
	return {
		shape: 'fenced',
		[WRITES_LINES]: (node) => writeFenced(node, spec),
		[READS_LINES]: fencedReading(spec)
	};
}

// Every line takes the opening line's ending, the closing one only where it had one.
function writeFenced<D extends object>(node: CstNode, spec: FencedSpec<D>): void {
	const [row, ...rest] = node.children!;
	const body = spec.title ? rest : node.children!;
	const data = (node.metadata ?? {}) as D;
	const ending = firstLineEnding(node.raw) ?? '\n';
	const opening = [spec.write(data)];
	if (spec.title) opening.push(spec.title.write(row ? trimTrailingLineEnding(row.raw) : ''));
	const inner = (node.innerPrefix ?? '') + concatChildren(body) + (node.innerSuffix ?? '');
	const closer = spec.close.write(data) + (ownTrailingLineEnding(node.raw) ? ending : '');
	node.raw = opening.map((line) => line + ending).join('') + inner + closer;
}
