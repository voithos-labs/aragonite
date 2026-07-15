import type { NodeView } from '../../core/node-views';

/**
 * A list item is "user-empty" when every leaf descendant's raw is blank.
 * Stronger than "first child is an empty paragraph" — the shallow check
 * dropped trailing content (extra paragraphs, nested lists) when the first
 * paragraph happened to be empty.
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
