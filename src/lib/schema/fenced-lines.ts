/** Lines of a container's own around its body (`<details>` … `</details>`), which bring their own
 *  reader and writer so an app with no such container ships neither. */

import type { CstNode } from '../core/nodes';
import { concatChildren } from '../core/serializer';
import { firstLineEnding, ownTrailingLineEnding, trimTrailingLineEnding } from '../core/lines';
import { READS_LINES, WRITES_LINES, type FencedLines } from '../core/strip-lines';
import { fencedReading, type FencedSpec } from './fence-shape';

/** A container opened by a line read into data (`<details open>`), titled by the line under it
 *  where `title` names one, and closed by a line of its own; the editor writes every line. */
export function fencedLines<D extends object>(spec: FencedSpec<D>): FencedLines<D> {
	const reading = fencedReading(spec);
	return {
		shape: 'fenced',
		[WRITES_LINES]: (node) => writeFenced(node, spec, reading.titled),
		[READS_LINES]: reading
	};
}

// Every line takes the opening line's ending, the closing one only where it had one.
function writeFenced<D extends object>(node: CstNode, spec: FencedSpec<D>, titled: boolean): void {
	const children = node.children!;
	const body = titled ? children.slice(1) : children;
	const data = (node.metadata ?? {}) as D;
	const ending = firstLineEnding(node.raw) ?? '\n';
	const title = titled && children[0] ? trimTrailingLineEnding(children[0].raw) : '';
	const opening = [spec.write(data), ...(spec.title ? [spec.title.write(title)] : [])];
	const inner = (node.innerPrefix ?? '') + concatChildren(body) + (node.innerSuffix ?? '');
	const closer = spec.close.write(data) + (ownTrailingLineEnding(node.raw) ? ending : '');
	node.raw = opening.map((line) => line + ending).join('') + inner + closer;
}
