/**
 * G1.151: after a keystroke's in-place write, no node it wrote is still shared with an undo entry,
 * since a write through a shared node rewrites history (G1.9). Per key and scoped to the written
 * chain; the whole-entry digest runs at the commit after the batch.
 */

import type { NodeView } from '../core/node-views';
import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';

export function checkWrittenUnshared(
	written: readonly NodeView[],
	isShared: (node: NodeView) => boolean
): InvariantViolation | null {
	const shared = written.find(isShared);
	return shared
		? {
				code: 'written-unshared',
				message: `a keystroke wrote a ${shared.kind} an undo entry still shares`
			}
		: null;
}
