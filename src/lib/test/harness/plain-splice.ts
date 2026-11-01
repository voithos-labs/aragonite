import type { NodeView } from '#lib/core/node-views.js';
import { ownTrailingLineEnding, trimTrailingLineEnding } from '#lib/core/lines.js';
import type { LeafRangeEdit } from '#lib/tree-operations/leaf-range.js';

/** Whether `edit` is `[start, end)` of `node` spliced with `typed`, nothing moved or cleaned. */
export function isPlainSplice(
	node: NodeView,
	{ start, end }: { start: number; end: number },
	typed: string,
	edit: Pick<LeafRangeEdit, 'raw' | 'caret'>
): boolean {
	const display = trimTrailingLineEnding(node.raw);
	const spliced =
		display.slice(0, start) + typed + display.slice(end) + ownTrailingLineEnding(node.raw);
	return edit.raw === spliced && edit.caret === start + typed.length;
}
