/**
 * Commit-seam path-dialect check: every path a commit declares (edit-event
 * target, no-caret snapshot fallback) must be doc-absolute — each prefix
 * resolves to an existing child from the document root. The final index may
 * be one past the end because insert-shaped ops (append, insert-below-last)
 * legitimately name the slot they create. A scope-local index leaking in as
 * a "path" fails here loudly instead of surfacing as a mis-targeted event or
 * a silently dropped caret restore. The `DocPath` param is a compile-time gate
 * complementing the runtime check — types don't bind JS callers, so both stay.
 */

import type { CstNode, Document } from '../core/nodes';
import type { DocPath } from '../selection/path-math';
import type { InvariantViolation } from './assert';

export function checkCommitPathAddressable(
	doc: Document,
	path: DocPath,
	role: 'eventPath' | 'snapshot.path'
): InvariantViolation | null {
	let parent: CstNode | Document = doc;
	for (let i = 0; i < path.length; i++) {
		const children: CstNode[] | undefined = parent.children;
		const idx = path[i];
		const isLast = i === path.length - 1;
		const limit = (children?.length ?? 0) + (isLast ? 1 : 0);
		if (!children || idx < 0 || idx >= limit) {
			return {
				code: 'commit-path-dialect',
				message: `commit ${role} [${path.join(',')}] does not resolve from the document root`,
				detail: { role, path, failedAt: i }
			};
		}
		if (!isLast) parent = children[idx];
	}
	return null;
}
