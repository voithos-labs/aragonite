import type { NodeView } from '../../core/node-views';
import { isBlankText } from '../../core/lines';

/**
 * A list item is empty to the user when every leaf's raw is blank; checking only the first child
 * would drop trailing content under an empty first paragraph.
 */
export function isItemUserEmpty(item: NodeView): boolean {
	if (!item.children || item.children.length === 0) return true;
	for (const child of item.children) {
		if (child.children && child.children.length > 0) {
			if (!isItemUserEmpty(child)) return false;
		} else if (!isBlankText(child.raw ?? '')) {
			return false;
		}
	}
	return true;
}
