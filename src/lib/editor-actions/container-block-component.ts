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
} from './focus/focus-dispatch';
import { revealChildOrWait } from '../reactivity/publish-ref.svelte';
import type { CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { isVerticallyTransparentNode } from '../core/inline/transparency';
import { devWarn } from '../dev-warn';

// ── Whole-block focus surface ───────────────────────────────────────────────

/**
 * A key that originates in a plugin's own text-editing surface (an edit
 * textarea, an input, a nested contenteditable) belongs to that surface, never
 * the whole-block affordances — so a Backspace inside a mermaid edit textarea
 * edits text, it does not delete the block.
 */
export function isEditableEventTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	const tag = target.tagName;
	return tag === 'TEXTAREA' || tag === 'INPUT' || target.isContentEditable;
}

/**
 * The class guard behind `getFocusEl`: a whole-block `focus()` whose declared
 * element is absent must degrade to a focusable box, never a silent no-op that
 * strands the caret (the broken-mermaid trap). One composed getter feeds every
 * consumer — the shim's focus/offset members and the factory keydown gate — so
 * they agree on the surface by construction. The one legitimate null survives:
 * a plugin-owned editable inside the box holding focus (edit mode) keeps its
 * keys and its caret. Falling back dev-warns once per mount, naming the kind.
 */
export function composeWholeBlockFocusSurface(
	getFocusEl: () => HTMLElement | null | undefined,
	getBoxEl: () => HTMLElement | null | undefined,
	getKind: () => string
): () => HTMLElement | null {
	let warned = false;
	return () => {
		const declared = getFocusEl();
		if (declared) return declared;
		const box = getBoxEl();
		if (!box) return null;
		const active = document.activeElement;
		if (isEditableEventTarget(active) && box.contains(active)) return null;
		if (!warned) {
			warned = true;
			devWarn(
				'container-block',
				`whole-block kind "${getKind()}" supplied no focus element for this state; falling back to the box`
			);
		}
		return box;
	};
}

// The declared surface carries its own tabindex (a tabindex=0 viewport); the
// fallback box is a plain div, focusable only once a tabindex is minted. Never
// overwrite an explicit one — that could remove tab-reachability.
function focusWholeBlockEl(el: HTMLElement): void {
	if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
	el.focus();
}

export interface ContainerBlockComponentDeps {
	readonly innerBlockRefs: (BlockComponent | undefined)[];
	readonly nodeChildrenLength: number;
	/** The container's CST node, for the pure-data transparency test — works
	 *  off-window where `innerBlockRefs` is sparse (VR-6). */
	readonly node: NodeView;
	/** Scroll this scope so child `index` enters its window; resolves after a tick. */
	readonly revealChild?: (index: number) => Promise<void>;
	/** True iff `index` is in this scope's current window; lets the reveal degrade
	 *  instead of hanging when a scroll missed (VR-5). */
	readonly isInWindow?: (index: number) => boolean;
	/** Collapse clamp — while true only the chrome row (child 0) is mounted, so a
	 *  focus extremum entering the container clamps to it instead of no-oping on
	 *  an unmounted last child (the caret-walk-into-collapsed rule). */
	readonly isCollapsed?: () => boolean;
	/** Whole-block-focus element for an opaque childless container (a plugin
	 *  diagram): when supplied, caret entry focuses this element instead of
	 *  walking into children (which no-op on `children: []`), and the cursor
	 *  offset reads 0 while it or a descendant holds focus (ThematicBreak's model).
	 *  The container factory hands the shim a getter already composed through
	 *  `composeWholeBlockFocusSurface`, so a null only remains when there is
	 *  genuinely nothing to focus (pre-mount, or a plugin editable holds focus). */
	readonly getFocusEl?: () => HTMLElement | null | undefined;
	/** The container's chrome box, for the opaque single-unit `measurePartialRects`
	 *  below. A childless opaque container (a plugin diagram) has no child hosts to
	 *  paint search/decoration rects, so the overlay measures the block itself off
	 *  this element. Read live, never snapshotted. */
	readonly getBoxEl?: () => HTMLElement | null | undefined;
}

/**
 * The container shim's surface, with the members it always supplies promoted to
 * required — so a container host re-exports them for BlockHost without a
 * per-member non-null assertion. Re-exported under this name from the plugin
 * container seam.
 */
export type ContainerBlockComponent = BlockComponent &
	Required<
		Pick<
			BlockComponent,
			| 'getCursorPosition'
			| 'focusByPath'
			| 'getBlockComponentByPath'
			| 'revealByPath'
			| 'focusAtColumn'
			| 'isVerticallyTransparent'
			| 'enterEdgeWidget'
		>
	>;

export function createContainerBlockComponent(
	deps: ContainerBlockComponentDeps
): ContainerBlockComponent {
	return {
		editable: true,
		focusable: true,
		focus(offset: number) {
			// Whole-block focus: any caret entry lands on the block itself, the
			// element offset carries no meaning (ThematicBreak's model).
			const focusEl = deps.getFocusEl?.();
			if (focusEl) {
				focusWholeBlockEl(focusEl);
				return;
			}
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
			const focusEl = deps.getFocusEl?.();
			if (focusEl) return focusEl.contains(document.activeElement) ? 0 : null;
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
			// Whole-block focus has no column to land in — a vertical (ArrowUp/Down)
			// entry focuses the block itself, mirroring the plain-arrow path.
			const focusEl = deps.getFocusEl?.();
			if (focusEl) {
				focusWholeBlockEl(focusEl);
				return;
			}
			if (deps.nodeChildrenLength === 0) return;
			dispatchFocusAtColumn(deps.innerBlockRefs, x, from);
		},
		isVerticallyTransparent(): boolean {
			return isVerticallyTransparentNode(deps.node);
		},
		enterEdgeWidget(side: 'start' | 'end'): boolean {
			if (deps.nodeChildrenLength === 0) return false;
			const edge = side === 'start' ? 0 : deps.nodeChildrenLength - 1;
			return deps.innerBlockRefs[edge]?.enterEdgeWidget?.(side) ?? false;
		},
		measurePartialRects(start: number, end: number): DOMRect[] {
			// Opaque single-unit: a childless container has no children to delegate
			// to, so any non-empty range paints the whole box; a child-bearing
			// container returns nothing — its children self-paint through their own
			// hosts, and the overlay routes to them on `hasChildHosts`.
			if (deps.nodeChildrenLength > 0) return [];
			const box = deps.getBoxEl?.();
			if (!box || end <= start) return [];
			return [box.getBoundingClientRect()];
		}
	};
}
