/**
 * What a list item leaves once its first block goes, whether Backspace merged it into the item
 * above (M1) or a range took it: the marker line goes too, and every line under it keeps its bytes
 * (`docs/design/structural-edits.md` § Container unwrap).
 */

import type { NodeView } from '../../core/node-views';
import { splitLines } from '../../core/lines';
import { unwrapRoleOf } from '../../schema/reserved-chrome';

/** Whether `list`'s items merge by their marker line, so an item that loses its first block loses
 *  the line its marker sits on. */
export function mergesByMarkerLine(list: NodeView | undefined): boolean {
	return !!list && unwrapRoleOf(list.kind)?.middleChildBackspace === 'list-item-cascade';
}

/** The list's bytes with item `index`'s marker line and its first block gone, the lines under it as
 *  they stood; its blank line above goes with the marker line. Every item's raw must be current. */
export function bytesWithoutMarkerLine(items: readonly NodeView[], index: number): string {
	let bytes = '';
	for (let i = 0; i < items.length; i++) {
		bytes += i === index ? linesBelowFirstBlock(items[i]) : items[i].leadingTrivia + items[i].raw;
	}
	return bytes;
}

function linesBelowFirstBlock(item: NodeView): string {
	const own = splitLines(item.children![0].raw).length;
	const lines = splitLines(item.raw);
	return lines.length > own ? item.raw.slice(lines[own - 1].end) : '';
}
