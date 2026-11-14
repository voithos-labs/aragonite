/**
 * G1.223: a line break over a range breaks a line where its key runs: that block's keymap binds the
 * key to a line break, and the block is no container's title row, whose Enter goes into the body.
 */

import type { DocumentView, NodeView } from '../core/node-views';
import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';
import { isReservedChromeChild } from '../schema/reserved-chrome';

/** `breaks`: the key's command in the block at `path` is a line break (`commandGesture`). */
export function checkBreakLanding(
	doc: DocumentView,
	path: readonly number[],
	breaks: boolean
): InvariantViolation | null {
	let owner: DocumentView | NodeView | undefined = doc;
	for (const i of path.slice(0, -1)) owner = owner?.children?.[i];
	const onRow =
		path.length > 1 && !!owner && isReservedChromeChild(owner as NodeView, path[path.length - 1]);
	if (breaks && !onRow) return null;
	return {
		code: 'range-break-landing',
		message: `a line break over a range ran at ${JSON.stringify(path)}, ${onRow ? 'a title row' : 'whose key breaks no line'}`
	};
}
