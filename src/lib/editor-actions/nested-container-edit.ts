/**
 * ContainerEditActions factory for container nestedActions bundles. Forwards
 * checkpoint and commit calls upward, remapping inner indices and event paths
 * to the enclosing container's coordinate system. Copy-path-on-write and
 * ancestry raw rebuilds live in the top-level primitives — every spine method
 * here forwards doc-absolute arguments unchanged.
 */

import type { ContainerEditActions } from '../action-contracts';
import type { CstNode } from '../core/nodes';
import type { NestedActionsDeps } from './nested-actions';

export function createNestedContainerEdit(deps: NestedActionsDeps): ContainerEditActions {
	const { parent } = deps;

	return {
		pushDebouncedCheckpoint(_innerIndex: number, offset: number, batchKey?: string | number): void {
			parent.containerEdit.pushDebouncedCheckpoint(deps.index, offset, batchKey);
		},

		nudgeReactivity(): void {
			parent.containerEdit.nudgeReactivity();
		},

		withUnsharedSpine(absPath: number[], write: (chain: CstNode[]) => void): void {
			parent.containerEdit.withUnsharedSpine(absPath, write);
		},

		commitContainer({
			containerNode,
			path,
			state: innerState,
			snapshot,
			mutate,
			op,
			afterTick
		}): Promise<void> {
			// Forward to the enclosing container, remapping the snapshot's
			// blockIndex to this container's own doc-relative index and prepending
			// `deps.index` to the edit event path. Inner containerNode/path/
			// innerState/mutate/afterTick pass through unchanged — they describe
			// the inner mutation, not the ancestry.
			const remappedSnapshot =
				snapshot === 'skip' ? snapshot : { blockIndex: deps.index, offset: snapshot.offset };
			const remappedOp = op ? { ...op, eventPath: [deps.index, ...op.eventPath] } : undefined;
			return parent.containerEdit.commitContainer({
				containerNode,
				path,
				state: innerState,
				snapshot: remappedSnapshot,
				mutate,
				op: remappedOp,
				afterTick
			});
		}
	};
}
