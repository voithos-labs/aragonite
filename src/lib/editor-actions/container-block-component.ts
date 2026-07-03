/** Shared `BlockComponent` shim for container blocks. */

import {
	CURSOR_END,
	FOCUS_LAST_START,
	type BlockComponent,
	type StickyColumnDirection
} from '../block-component';
import {
	dispatchFocusByPath,
	dispatchFocusAtColumn,
	dispatchGetBlockComponentByPath
} from './focus-dispatch';
import { revealChildOrWait } from '../reactivity/publish-ref.svelte';
import type { CstNode } from '../core/nodes';
import { isVerticallyTransparentNode } from '../core/inline/transparency';

export interface ContainerBlockComponentDeps {
	readonly innerBlockRefs: (BlockComponent | undefined)[];
	readonly nodeChildrenLength: number;
	/** The container's CST node, for the pure-data transparency test — works
	 *  off-window where `innerBlockRefs` is sparse (VR-6). */
	readonly node: CstNode;
	/** Scroll this scope so child `index` enters its window; resolves after a tick. */
	readonly revealChild?: (index: number) => Promise<void>;
	/** True iff `index` is in this scope's current window; lets the reveal degrade
	 *  instead of hanging when a scroll missed (VR-5). */
	readonly isInWindow?: (index: number) => boolean;
	/** Collapse clamp — while true only the chrome row (child 0) is mounted, so a
	 *  focus extremum entering the container clamps to it instead of no-oping on
	 *  an unmounted last child (the caret-walk-into-collapsed rule). */
	readonly isCollapsed?: () => boolean;
}

export function createContainerBlockComponent(deps: ContainerBlockComponentDeps): BlockComponent {
	return {
		editable: true,
		focusable: true,
		focus(offset: number) {
			if (deps.nodeChildrenLength === 0) return;
			// Collapsed: only child 0 (the chrome row) is mounted, so a walk-in from
			// below — which targets the last child — clamps to it rather than no-oping
			// on the unmounted ref.
			const last = deps.isCollapsed?.() ? 0 : deps.nodeChildrenLength - 1;
			if (offset === FOCUS_LAST_START) {
				deps.innerBlockRefs[last]?.focus(FOCUS_LAST_START);
			} else if (offset === 0) {
				deps.innerBlockRefs[0]?.focus(0);
			} else {
				deps.innerBlockRefs[last]?.focus(CURSOR_END);
			}
		},
		getCursorOffset() {
			for (const ref of deps.innerBlockRefs) {
				const offset = ref?.getCursorOffset();
				if (offset !== null && offset !== undefined) return offset;
			}
			return null;
		},
		getCursorPosition() {
			for (let i = 0; i < deps.innerBlockRefs.length; i++) {
				const ref = deps.innerBlockRefs[i];
				if (!ref) continue;
				const subPos = ref.getCursorPosition?.();
				if (subPos) return { path: [i, ...subPos.path], offset: subPos.offset };
				const offset = ref.getCursorOffset();
				if (offset !== null && offset !== undefined) return { path: [i], offset };
			}
			return null;
		},
		focusByPath(path: number[], offset: number) {
			dispatchFocusByPath(deps.innerBlockRefs, path, offset);
		},
		getBlockComponentByPath(path: number[]): BlockComponent | null {
			return dispatchGetBlockComponentByPath(deps.innerBlockRefs, path);
		},
		async revealByPath(path: number[]): Promise<BlockComponent | null> {
			if (path.length === 0) return null;
			const [head, ...rest] = path;
			// A child scrolled off-window can leave a stale (detached) ref in this
			// scope's slot: publishRefSlot's cleanup is conditional, so slot truthiness
			// is a cache, not a mount oracle. Gate the scroll on the live window bounds
			// (isStale) and clear the detached ref (dropRef) so the mount-wait resolves
			// on the FRESH child. Without this, collapsing a cross-block selection back
			// onto an off-window anchor item skips the scroll, descends into the stale
			// ref, and hangs the reveal — leaving the caret stranded at the focus end.
			const isInWindow = deps.isInWindow;
			if (deps.revealChild) {
				await revealChildOrWait(head, {
					childCount: deps.nodeChildrenLength,
					getRef: (i) => deps.innerBlockRefs[i],
					dropRef: (i) => (deps.innerBlockRefs[i] = undefined),
					revealChild: deps.revealChild,
					isStale: isInWindow ? (i) => !isInWindow(i) : undefined,
					isInWindow
				});
			}
			const ref = deps.innerBlockRefs[head];
			if (!ref) return null;
			if (rest.length === 0) return ref;
			return ref.revealByPath
				? ref.revealByPath(rest)
				: (ref.getBlockComponentByPath?.(rest) ?? null);
		},
		focusAtColumn(x: number, from: StickyColumnDirection) {
			if (deps.nodeChildrenLength === 0) return;
			dispatchFocusAtColumn(deps.innerBlockRefs, x, from);
		},
		isVerticallyTransparent(): boolean {
			return isVerticallyTransparentNode(deps.node);
		},
		selectEdgeWidget(side: 'start' | 'end'): boolean {
			if (deps.nodeChildrenLength === 0) return false;
			const edge = side === 'start' ? 0 : deps.nodeChildrenLength - 1;
			return deps.innerBlockRefs[edge]?.selectEdgeWidget?.(side) ?? false;
		}
	};
}
