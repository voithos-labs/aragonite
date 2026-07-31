import type { NodeView } from '../../core/node-views';

/**
 * A list item is "user-empty" when every leaf descendant's raw is blank. Deliberately
 * stronger than testing the first child: a shallow check drops trailing content whenever
 * the first paragraph happens to be empty.
 */
export function isItemUserEmpty(item: NodeView): boolean {
	if (!item.children || item.children.length === 0) return true;
	for (const child of item.children) {
		if (child.children && child.children.length > 0) {
			if (!isItemUserEmpty(child)) return false;
		} else if ((child.raw ?? '').trim() !== '') {
			return false;
		}
	}
	return true;
}
