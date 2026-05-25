/**
 * ContainerEditActions factory for container nestedActions bundles. Forwards
 * checkpoint and commit calls upward, remapping inner indices and event paths
 * to the enclosing container's coordinate system.
 */

import type { ContainerEditActions } from '../action-contracts';
import type { CstNode } from '../core/nodes';
import type { NestedActionsDeps } from './nested-actions';

export function createNestedContainerEdit(deps: NestedActionsDeps): ContainerEditActions {
	const { rebuildRaw, parent } = deps;

	return {
		pushDebouncedCheckpoint(_innerIndex: number, offset: number, batchKey?: string | number): void {
			parent.containerEdit.pushDebouncedCheckpoint(deps.index, offset, batchKey);
		},

		nudgeReactivity(): void {
			rebuildRaw();
			parent.containerEdit.nudgeReactivity();
		},

		commitContainer({
			containerNode,
			state: innerState,
			snapshot,
			mutate,
			op,
			afterTick
		}): Promise<void> {
			// Forward to the enclosing container, remapping the snapshot's
			// blockIndex to this container's own doc-relative index and prepending
			// `deps.index` to the edit event path. Inner containerNode/innerState/
			// mutate/afterTick pass through unchanged — they describe the inner
			// mutation, not the ancestry.
			const remappedSnapshot =
				snapshot === 'skip' ? snapshot : { blockIndex: deps.index, offset: snapshot.offset };
			const remappedOp = op
				? {
						kind: op.kind,
						detail: op.detail,
						eventPath: [deps.index, ...op.eventPath]
					}
				: undefined;
			// Ancestry raw must rebuild whenever a descendant mutates — wrap the
			// inner mutate so our rebuildRaw runs after it.
			const wrappedMutate = (children: CstNode[]) => {
				const change = mutate(children);
				rebuildRaw();
				return change;
			};
			return parent.containerEdit.commitContainer({
				containerNode,
				state: innerState,
				snapshot: remappedSnapshot,
				mutate: wrappedMutate,
				op: remappedOp,
				afterTick
			});
		}
	};
}
