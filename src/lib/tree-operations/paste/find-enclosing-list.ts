import type { CstNode, Document } from '../../core/nodes';
import { nodeAt } from '../node-ops';

/** Returns null when no list ancestor exists or the target isn't a direct leaf of a listItem. */
export function findEnclosingListForPaste(
	doc: Document,
	targetPath: number[]
): { list: CstNode; listPath: number[]; itemIndex: number; innerIndex: number } | null {
	if (targetPath.length < 3) return null;

	let listDepth = -1;
	let list: CstNode | null = null;
	for (let depth = targetPath.length - 1; depth >= 1; depth--) {
		const ancestor = nodeAt(doc, targetPath.slice(0, depth)) as CstNode | null;
		if (!ancestor) return null;
		if (ancestor.kind === 'list') {
			listDepth = depth;
			list = ancestor;
			break;
		}
	}
	if (listDepth === -1 || !list) return null;
	// Merge semantics are undefined for a target nested in a deeper container, so only
	// direct leaves of a listItem qualify; the rest fall through to structural paste.
	if (targetPath.length !== listDepth + 2) return null;

	return {
		list,
		listPath: targetPath.slice(0, listDepth),
		itemIndex: targetPath[listDepth],
		innerIndex: targetPath[listDepth + 1]
	};
}
