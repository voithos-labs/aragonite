/**
 * Every mounted block list of one editor, so the scroll owner can read the document through their
 * height tables: where a block sits, and which one block to keep still across a measure round.
 * See `docs/design/virtual-rendering.md` § Keeping the page still while heights change.
 */
import type { TargetTop } from '../cursor/scroll-owner';
import {
	focusedIndexIn,
	heldBlock,
	heldPathMoved,
	heldStep,
	type HeightTable,
	type HeldDelta,
	type HeldStep
} from './hold-across';

/** One block list as the tree reads it. */
export interface ListLevel {
	path(): readonly number[];
	/** The table the scroll was last corrected against; a rebuild still waiting for its correction
	 *  reads differently from `current`. */
	settled(): HeightTable;
	current(): HeightTable;
	/** The root list's top in the scroll content, a nested list's top below the top of the box its
	 *  parent measures; null before it mounts. */
	top(): number | null;
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
	/** Picks the block to keep still from the tables and the scroll as they stand; the returned
	 *  read says how far that block has moved since. Null with nothing to hold. */
	holdForRound(): (() => HeldDelta) | null;
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

	function holdForRound(): (() => HeldDelta) | null {
		const scrollTop = deps.getScrollTop();
		const root = levelAt([]);
		const rootTop = root?.top() ?? null;
		if (scrollTop === null || !root || rootTop === null) return null;
		let level: ListLevel = root;
		const focus = deps.getFocusPath();
		const path: HeldStep[] = [];
		let localTop = Math.max(0, scrollTop - rootTop);
		for (;;) {
			const settled: HeightTable = level.settled();
			const current = level.current;
			const held = heldBlock(settled, current(), localTop, focusedIndexIn(focus, level.path()));
			if (!held) break;
			path.push(heldStep(settled, held, current));
			// Nested lists read their path live, so the held block is looked up where it is now.
			const now: number = current() === settled ? held.index : current().ids.indexOf(held.id);
			const inner: ListLevel | undefined = now === -1 ? undefined : levelAt([...level.path(), now]);
			const chrome = inner?.top() ?? null;
			if (!inner || chrome === null) break;
			localTop = Math.max(0, localTop - settled.model.offsetOf(held.index) - chrome);
			level = inner;
		}
		return path.length === 0 ? null : () => heldPathMoved(path);
	}

	return {
		add(level) {
			levels.add(level);
			return () => levels.delete(level);
		},
		resolve(path) {
			const root = levelAt([]);
			let top = root?.top() ?? null;
			if (!root || top === null || path.length === 0) return null;
			let level: ListLevel = root;
			let height = 0;
			for (let depth = 0; depth < path.length; depth++) {
				const { model } = level.current();
				const index = path[depth];
				if (index >= model.size) return null;
				top += model.offsetOf(index);
				height = model.heightOf(index);
				if (depth === path.length - 1) break;
				const inner = levelAt(path.slice(0, depth + 1));
				const chrome = inner?.top() ?? null;
				// An unmounted container stands in with its own top.
				if (!inner || chrome === null) break;
				// The user scrolled past the target inside a mounted container: decline, not jump.
				if (!inner.isInWindow(path[depth + 1])) return null;
				top += chrome;
				level = inner;
			}
			return { top, height };
		},
		holdForRound
	};
}
