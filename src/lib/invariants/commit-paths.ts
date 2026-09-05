/**
 * G1.16 — every path a commit declares is doc-absolute: each prefix resolves to an
 * existing child from the document root. The final index may be one past the end, since
 * insert-shaped ops legitimately name the slot they create. The `DocPath` param is the
 * compile-time gate; this stays the runtime belt for the JS callers types don't bind.
 */

import type { CstNode, Document } from '../core/nodes';
import type { DocPath } from '../selection/path-math';
import type { InvariantViolation } from '../assert';

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
