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

export interface ContainerBlockComponentDeps {
	readonly innerBlockRefs: (BlockComponent | undefined)[];
	readonly nodeChildrenLength: number;
	/** Scroll this scope so child `index` enters its window; resolves after a tick. */
	readonly revealChild?: (index: number) => Promise<void>;
	/** True iff `index` is in this scope's current window; lets the reveal degrade
	 *  instead of hanging when a scroll missed (VR-5). */
	readonly isInWindow?: (index: number) => boolean;
}

export function createContainerBlockComponent(deps: ContainerBlockComponentDeps): BlockComponent {
	return {
		editable: true,
		focusable: true,
		focus(offset: number) {
			if (deps.nodeChildrenLength === 0) return;
			if (offset === FOCUS_LAST_START) {
				const last = deps.nodeChildrenLength - 1;
				deps.innerBlockRefs[last]?.focus(FOCUS_LAST_START);
			} else if (offset === 0) {
				deps.innerBlockRefs[0]?.focus(0);
			} else {
				const last = deps.nodeChildrenLength - 1;
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
			// No isStale: a windowed each keyed by absolute index clears its slot on
			// unmount, so an off-window child's slot is already undefined here — the
			// !getRef gate fires and revealChild runs. TableBlock passes isStale
			// because its slots can hold a detached ref off-window (see its revealByPath).
			if (deps.revealChild) {
				await revealChildOrWait(head, {
					childCount: deps.nodeChildrenLength,
					getRef: (i) => deps.innerBlockRefs[i],
					revealChild: deps.revealChild,
					isInWindow: deps.isInWindow
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
			if (deps.nodeChildrenLength === 0) return false;
			return deps.innerBlockRefs.every((ref) => ref?.isVerticallyTransparent?.() ?? false);
		},
		selectEdgeWidget(side: 'start' | 'end'): boolean {
			if (deps.nodeChildrenLength === 0) return false;
			const edge = side === 'start' ? 0 : deps.nodeChildrenLength - 1;
			return deps.innerBlockRefs[edge]?.selectEdgeWidget?.(side) ?? false;
		}
	};
}
