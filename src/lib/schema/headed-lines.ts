/** Marked lines under a head line, which bring their own writer so an app with no headed container
 *  (an alert's `> [!NOTE]`) doesn't ship it. */

import type { CstNode } from '../core/nodes';
import { firstDisplayLine, ownTrailingLineEnding } from '../core/lines';
import {
	codecFromShape,
	WRITES_LINES,
	type HeadedLines,
	type MarkedLines
} from '../core/strip-lines';
import type { GrammarView } from './block-openers';
import { dropChildSpans, type ChildRawChange } from './child-spans';
import { bodyHasNoBytes, rebuildStripRaw, type StripRebuild } from './strip-rebuild';
import { dataOver } from './container-writer';

/** `lines` under a first line that holds no child: `head.match` reads it after the marker, `data`
 *  turns the match into the container's data, and `write` spells it. */
export function headedLines<D extends object>(
	lines: MarkedLines & { head: HeadedLines<D>['head'] }
): HeadedLines<D> {
	const shape: HeadedLines<D> = {
		...lines,
		[WRITES_LINES]: (node, grammar, changed) => writeHeaded(node, shape, grammar, changed)
	};
	return shape;
}

/** The head line, kept as spelled while it writes the same data, the body as the shape's lines
 *  below it; an emptied body leaves the head line alone, which still opens the container. */
function writeHeaded<D extends object>(
	node: CstNode,
	shape: HeadedLines<D>,
	grammar: GrammarView,
	changed: ChildRawChange | undefined
): StripRebuild | undefined {
	const { head } = shape;
	const old = firstDisplayLine(node.raw).text;
	const marker = shape.reads.exec(old);
	const read = marker ? head.match.exec(old.slice(marker[0].length)) : null;
	const was = read ? head.data(read) : undefined;
	const written = head.write(dataOver(node, was));
	const line = was !== undefined && head.write(was) === written ? old : shape.first + written;
	if (!node.innerPrefix && bodyHasNoBytes(node)) {
		node.raw = line + ownTrailingLineEnding(node.raw);
		dropChildSpans(node);
		return;
	}
	return rebuildStripRaw(node, codecFromShape(shape), { grammar, changed, opener: line });
}
