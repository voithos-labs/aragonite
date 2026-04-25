/**
 * Shared `BlockComponent` shim for container blocks (Blockquote, List, ListItem).
 * Each container's Svelte component delegates focus/cursor methods here so the
 * three container components don't carry duplicated 15-line shim implementations.
 */

import {
	CURSOR_END,
	FOCUS_LAST_START,
	type BlockComponent,
	type StickyColumnDirection
} from '../contracts';
import { dispatchFocusByPath, dispatchFocusAtColumn } from './focus-dispatch';

export interface ContainerBlockComponentDeps {
	readonly innerBlockRefs: (BlockComponent | undefined)[];
	readonly nodeChildrenLength: number;
}

export function createContainerBlockComponent(deps: ContainerBlockComponentDeps): {
	focus: (offset: number) => void;
	getCursorOffset: () => number | null;
	focusByPath: (path: number[], offset: number) => void;
	focusAtColumn: (x: number, from: StickyColumnDirection) => void;
} {
	return {
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
		focusByPath(path: number[], offset: number) {
			dispatchFocusByPath(deps.innerBlockRefs, path, offset);
		},
		focusAtColumn(x: number, from: StickyColumnDirection) {
			if (deps.nodeChildrenLength === 0) return;
			dispatchFocusAtColumn(deps.innerBlockRefs, x, from);
		}
	};
}
