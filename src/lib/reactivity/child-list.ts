/**
 * One block list's children as a walk down the tree reads them, and the two walks: `descendTo`
 * scrolls each level's child into the mounted range, `componentAt` reads only what is mounted.
 * The editor root, every container, the table and each table row publish one.
 */
import type { BlockComponent } from '../block-component';
import type { ListWindowing } from './list-windowing.svelte';
import { revealChildOrWait, type RefSlots } from './publish-ref.svelte';

/** One mounted child list, as the descent reads it. Every field is read live. */
export interface ChildList {
	count(): number;
	readonly refs: RefSlots<BlockComponent>;
	/** Required, so a list that cannot say whether a child is in range cannot exist. */
	readonly windowing: Pick<ListWindowing, 'revealChild' | 'isInWindow'>;
	/** Scrolls child `index` into this list's own scroller on another axis (a table's columns). */
	bringChildIntoView?(index: number): void;
	/** True while only the title row (child 0) is mounted. */
	isCollapsed?(): boolean;
	/** Opens a collapsed body as an undoable commit; only a navigation descent calls it. */
	openCollapsed?(): Promise<boolean>;
}

/**
 * Mounts each level of `path` below `root` and returns the component at its end, or null when
 * a level can't mount. A path into a collapsed body stops there unless `openCollapsed` is set.
 */
export async function descendTo(
	root: ChildList,
	path: readonly number[],
	opts: { openCollapsed?: boolean } = {}
): Promise<BlockComponent | null> {
	let list = root;
	for (let depth = 0; depth < path.length; depth++) {
		const index = path[depth];
		// Only a body child is hidden; the title row stays mounted while collapsed.
		if (index >= 1 && list.isCollapsed?.()) {
			if (!opts.openCollapsed || !list.openCollapsed) return null;
			await list.openCollapsed();
		}
		const { windowing } = list;
		await revealChildOrWait(index, {
			slots: list.refs,
			childCount: list.count(),
			revealChild: (i) => windowing.revealChild(i),
			isInWindow: (i) => windowing.isInWindow(i)
		});
		const ref = list.refs.get(index);
		if (!ref) return null;
		list.bringChildIntoView?.(index);
		if (depth === path.length - 1) return ref;
		const next = ref.childList?.();
		if (!next) return null;
		list = next;
	}
	return null;
}

/** The mounted component at `path`, or null; never mounts anything. */
export function componentAt(root: ChildList, path: readonly number[]): BlockComponent | null {
	let list: ChildList | undefined = root;
	for (let depth = 0; depth < path.length && list; depth++) {
		const ref = list.refs.get(path[depth]);
		if (!ref) return null;
		if (depth === path.length - 1) return ref;
		list = ref.childList?.();
	}
	return null;
}
