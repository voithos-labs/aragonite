/**
 * Every mounted block list of one editor, so the scroll owner can read the document through their
 * height tables: where a block sits, and which one block to keep still across a measure round.
 * See `docs/design/virtual-rendering.md` § Keeping the page still while heights change.
 */
import type { TargetTop } from './scroll-owner';
import {
	focusedIndexIn,
	heldBlock,
	heldDelta,
	heldIndexIn,
	type HeightTable,
	type HeldBlock,
	type HeldDelta
} from './pinned-block';

/** One block list as the tree reads it. */
export interface ListLevel {
	path(): readonly number[];
	/** The table as last built, read without building one: what a round opening in the middle of
	 *  a change counts from. */
	built(): HeightTable;
	/** The table as it reads now, rebuilt first if the list's blocks changed. */
	current(): HeightTable;
	/** The root list's top in the scroll content, a nested list's top below the top of the box its
	 *  parent measures; null before it mounts. */
	top(): number | null;
	/** This list's top in the scroll content, off its element; null before it mounts. */
	contentTop(): number | null;
	isInWindow(index: number): boolean;
}

export interface ListTreeDeps {
	getScrollTop: () => number | null;
	getFocusPath: () => readonly number[] | null;
}

export interface ListTree {
	add(level: ListLevel): () => void;
	/** Where the block at `path` sits in the scroll content, from the tables along its path; null
	 *  when a mounted container has windowed it out. */
	resolve(path: readonly number[]): TargetTop | null;
	/** Where to scroll so the list holding `path` mounts that block: the list's top plus its table's
	 *  offset of the block. */
	mountTop(path: readonly number[]): number | null;
	/** Picks the block to keep still from the tables and the scroll as they stand; the returned
	 *  read says how far that block has moved since. Null with nothing to hold. */
	holdForRound(): (() => HeldDelta) | null;
}

/** One level of a held block's path: the list, the block it picked, and the table it picked from. */
interface HeldStep {
	level: ListLevel;
	held: HeldBlock;
	table: HeightTable;
}

export function createListTree(deps: ListTreeDeps): ListTree {
	const levels = new Set<ListLevel>();

	function levelAt(path: readonly number[]): ListLevel | undefined {
		for (const level of levels) {
			const at = level.path();
			if (at.length === path.length && at.every((index, i) => index === path[i])) return level;
		}
		return undefined;
	}

	/** The one walk down a path: the offset below the root list's top at each level it reaches,
	 *  mounted containers' chrome included; null past a table's end, or a windowed-out block. */
	function walk(
		path: readonly number[],
		read: (level: ListLevel) => HeightTable,
		inWindowOnly: boolean
	): { offsets: number[]; height: number } | null {
		let level = levelAt([]);
		if (!level) return null;
		const offsets: number[] = [];
		let offset = 0;
		let height = 0;
		for (let depth = 0; depth < path.length; depth++) {
			const { model } = read(level);
			const index = path[depth];
			if (index >= model.size) return null;
			offset += model.offsetOf(index);
			height = model.heightOf(index);
			offsets.push(offset);
			if (depth === path.length - 1) break;
			const inner = levelAt(path.slice(0, depth + 1));
			const chrome = inner?.top() ?? null;
			// An unmounted container stands in with its own top.
			if (!inner || chrome === null) break;
			// The user scrolled past the target inside a mounted container: decline, not jump.
			if (inWindowOnly && !inner.isInWindow(path[depth + 1])) return null;
			offset += chrome;
			level = inner;
		}
		return { offsets, height };
	}

	/** The held block at each level, from the viewport's top down, preferring the caret's block. */
	function descend(localTop: number, focus: readonly number[] | null): HeldStep[] {
		const steps: HeldStep[] = [];
		let level = levelAt([]);
		let top = localTop;
		while (level) {
			const table = level.built();
			const held = heldBlock(table, top, focusedIndexIn(focus, level.path()));
			if (!held) break;
			steps.push({ level, held, table });
			const inner = levelAt([...level.path(), held.index]);
			const chrome = inner?.top() ?? null;
			if (!inner || chrome === null) break;
			top = Math.max(0, top - table.model.offsetOf(held.index) - chrome);
			level = inner;
		}
		return steps;
	}

	/** The held path as indices now, cut at the first level whose block the change removed; empty
	 *  when the caret's block was moved, so the round falls back to the block at the top. */
	function pathNow(steps: HeldStep[]): number[] {
		const path: number[] = [];
		for (const { level, held, table } of steps) {
			// A list the round's change unmounted stands in with its container, as in `walk`.
			if (!levels.has(level)) return path;
			const index = heldIndexIn(held, table, level.current());
			if (index === -1) return held.focused ? [] : path;
			path.push(index);
		}
		return path;
	}

	function holdForRound(): (() => HeldDelta) | null {
		const scrollTop = deps.getScrollTop();
		const rootTop = levelAt([])?.top() ?? null;
		if (scrollTop === null || rootTop === null) return null;
		const localTop = Math.max(0, scrollTop - rootTop);
		const focus = deps.getFocusPath();
		const candidates = [descend(localTop, focus)];
		if (candidates[0].some((step) => step.held.focused)) candidates.push(descend(localTop, null));
		const before = candidates.map(
			(steps) =>
				walk(
					steps.map((step) => step.held.index),
					(level) => level.built(),
					false
				)?.offsets ?? []
		);
		if (before.every((offsets) => offsets.length === 0)) return null;
		function movedSince(): HeldDelta {
			let from = 0;
			let to = 0;
			for (let i = 0; i < candidates.length; i++) {
				const path = pathNow(candidates[i]);
				const after = path.length > 0 ? walk(path, (level) => level.current(), false) : null;
				if (!after) continue;
				from = before[i][path.length - 1];
				to = after.offsets[path.length - 1];
				break;
			}
			return heldDelta(from, to);
		}
		return movedSince;
	}

	return {
		add(level) {
			levels.add(level);
			return () => levels.delete(level);
		},
		resolve(path) {
			const rootTop = levelAt([])?.top() ?? null;
			if (rootTop === null || path.length === 0) return null;
			const at = walk(path, (level) => level.current(), true);
			if (!at) return null;
			return { top: rootTop + at.offsets[at.offsets.length - 1], height: at.height };
		},
		mountTop(path) {
			const level = levelAt(path.slice(0, -1));
			const top = level?.contentTop() ?? null;
			const index = path[path.length - 1];
			if (!level || top === null || index === undefined) return null;
			return top + level.current().model.offsetOf(index);
		},
		holdForRound
	};
}
