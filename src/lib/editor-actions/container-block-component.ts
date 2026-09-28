/** The shared `BlockComponent` implementation for container blocks. */

import {
	entryEdge,
	type BlockComponent,
	type ContainerBlockComponent,
	type StickyColumnDirection
} from '../block-component';
import { dispatchFocusByPath, dispatchFocusAtColumn } from './focus/focus-dispatch';
import type { ChildList } from '../reactivity/child-list';
import type { AnyBlockKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import type { BlockEditActions, FocusActions } from '../action-contracts';
import { runGlobalChordOnKind } from '../schema/commands';
import {
	dispatchKindCommand,
	type CommandDispatchContext,
	type KindCommandTarget
} from '../schema/block-commands';
import type { Reading } from '../schema/reading';
import { eventToChord, isCharacterKey } from '../schema/keybindings';
import { displayLength, trimTrailingLineEnding } from '../core/lines';
import { isVerticallyTransparentNode } from '../core/inline/transparency';
import type { CaretMemory } from '../cursor/caret-memory';
import type { AnyCommandId } from '../schema/command-id';
import type { SelectionState } from '../selection/selection-state.svelte';
import { placeCaret } from '../selection/caret-doors';
import { removalSideOfKey } from '../selection/caret-target';
import {
	focusWholeBlockEl,
	holdsWholeBlockFocus,
	type WholeBlockInputProxy
} from './whole-block-focus-surface';
import { devWarn } from '../dev-warn';

/** Undo, redo and plugin-global chords for a block focused as a whole, which neither an inner leaf
 *  nor the editor root runs. Consumed in reading mode too, or the browser runs its own undo. */
export function dispatchWholeBlockGlobalChord(
	e: KeyboardEvent,
	kind: AnyBlockKind,
	commands: CommandDispatchContext
): boolean {
	const chord = eventToChord(e);
	if (!chord || !runGlobalChordOnKind(chord, kind, commands)) return false;
	e.preventDefault();
	return true;
}

/**
 * A chord at a container, resolved against the container's own kind only: a key that bubbled up
 * from a focused leaf has already met the global chords there.
 */
export function dispatchContainerChord(
	e: KeyboardEvent,
	target: KindCommandTarget,
	commands: CommandDispatchContext
): boolean {
	if (e.defaultPrevented) return false;
	const chord = eventToChord(e);
	if (!chord || !dispatchKindCommand(chord, target, commands)) return false;
	e.preventDefault();
	return true;
}

export interface BlockEdgeExitDeps {
	getIndex: () => number;
	focus: Pick<FocusActions, 'moveFocus'>;
}

/** The plain-arrow exits out of a block, shared by whole-block focus and a plugin container's
 *  `moveFocusOut`, so a plugin editor leaves its edge as the built-ins do. False for other keys. */
export function focusAcrossBlockEdge(key: string, deps: BlockEdgeExitDeps): boolean {
	const index = deps.getIndex();
	if (key === 'ArrowUp') void deps.focus.moveFocus(index - 1, { stickyColumnFrom: 'below' });
	else if (key === 'ArrowLeft') void deps.focus.moveFocus(index - 1, 'end');
	else if (key === 'ArrowDown') void deps.focus.moveFocus(index + 1, { stickyColumnFrom: 'above' });
	else if (key === 'ArrowRight') void deps.focus.moveFocus(index + 1, 'start');
	else return false;
	return true;
}

export interface WholeBlockKeyDeps extends BlockEdgeExitDeps {
	getRaw: () => string;
	blockEdit: Pick<BlockEditActions, 'splitBlock' | 'deleteBlock' | 'insertParagraph'>;
	isReading: () => boolean;
	caretMemory: Pick<CaretMemory, 'noteKey'>;
	/** What the keypress resolves to at this block's kind, overrides included. */
	commandOf: (e: KeyboardEvent) => AnyCommandId | null;
}

/**
 * The whole-block key handling shared by ThematicBreakBlock and the plugin container
 * factory, so a new check lands once instead of at both. Navigation is never checked.
 */
export function handleWholeBlockKeys(e: KeyboardEvent, deps: WholeBlockKeyDeps): void {
	// Before any branch, or a column captured elsewhere survives a horizontal move through this
	// block. No `measureX`: a block focused whole has no caret to measure.
	deps.caretMemory.noteKey(e, deps.commandOf(e));

	if (e.key === 'Enter') {
		e.preventDefault();
		if (!deps.isReading())
			void deps.blockEdit.splitBlock(deps.getIndex(), displayLength(deps.getRaw()));
		return;
	}
	if (e.key === 'Backspace' || e.key === 'Delete') {
		e.preventDefault();
		if (!deps.isReading())
			void deps.blockEdit.deleteBlock(deps.getIndex(), removalSideOfKey(e.key));
		return;
	}

	// Mod+C and Mod+X copy the block's own markdown: a keydown carries no ClipboardEvent,
	// and preventDefault suppresses the native copy, so writeText is the only writer.
	if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'c' || e.key === 'x')) {
		e.preventDefault();
		void copyFocusedWholeBlock(deps, e.key === 'x');
		return;
	}

	// A typed character has nowhere to land on a block focused as a whole, so it creates the
	// paragraph below carrying it (`editor-actions/block-edit-core.ts :: insertParagraph`).
	if (isCharacterKey(e.key) && !e.isComposing && !e.ctrlKey && !e.metaKey && !e.altKey) {
		e.preventDefault();
		if (!deps.isReading()) void deps.blockEdit.insertParagraph(deps.getIndex() + 1, e.key);
		return;
	}

	const plainArrow = !e.altKey && !e.ctrlKey && !e.metaKey;
	if (plainArrow && focusAcrossBlockEdge(e.key, deps)) e.preventDefault();
}

// Copy is a read, so it is never blocked; cut's delete is blocked in reading mode and only
// runs once the clipboard write resolves, so a rejected write leaves the block in place.
async function copyFocusedWholeBlock(deps: WholeBlockKeyDeps, cut: boolean): Promise<void> {
	try {
		await navigator.clipboard.writeText(trimTrailingLineEnding(deps.getRaw()));
	} catch (err) {
		devWarn('container-block', 'whole-block clipboard write rejected', err);
		return;
	}
	if (cut && !deps.isReading()) void deps.blockEdit.deleteBlock(deps.getIndex(), 'after');
}

export interface ContainerBlockComponentDeps {
	/** What the mounted component reports as `editable`, mirroring the kind's descriptor flag;
	 *  omitted stays `true`, the built-in containers' answer. A getter, never a snapshot. */
	readonly editable?: boolean;
	/** Ends a live cross-block range when `focus` places a caret: focusing a whole block
	 *  reaches no child to borrow it from. */
	readonly selection: SelectionState;
	readonly innerBlockRefs: (BlockComponent | undefined)[];
	/** The same children as a descent reads them: their count, ref slots, render window and
	 *  collapse. `childList()` publishes it. */
	readonly childList: ChildList;
	/** For the widget-only check, which reads the node so it works for an unmounted
	 *  container where `innerBlockRefs` is sparse (VR-6). */
	readonly node: NodeView;
	/** How the editor reads its bytes, whose grammar the widget-only check reads the node in. */
	readonly reading: Reading;
	/** The focus element of a childless container focused as a whole, already composed
	 *  through `composeWholeBlockFocusSurface`. */
	readonly getFocusEl?: () => HTMLElement | null | undefined;
	/** A childless container has no child elements to measure search or decoration rects
	 *  from, so `measurePartialRects` measures the block itself off this element. */
	readonly getBoxEl?: () => HTMLElement | null | undefined;
	/** The hidden editing host beside the declared element, where whole-block focus lands. */
	readonly inputProxy?: WholeBlockInputProxy;
}

export function createContainerBlockComponent(
	deps: ContainerBlockComponentDeps
): ContainerBlockComponent {
	const landFocus = (declared: HTMLElement) =>
		deps.inputProxy ? deps.inputProxy.focus(declared) : focusWholeBlockEl(declared);

	/**
	 * `focus` lands in a child that has no `parkCaret`; `parkCaret` skips it, because during a
	 * selection extend a missed `parkCaret` costs a caret and `focus` costs the range.
	 */
	function walkInto(offset: number, land: (ref: BlockComponent, offset: number) => void): void {
		// Whole-block focus: any caret entry lands on the block itself, so the offset means
		// nothing.
		const focusEl = deps.getFocusEl?.();
		if (focusEl) {
			landFocus(focusEl);
			return;
		}
		const count = deps.childList.count();
		if (count === 0) return;
		// Collapsed: only the title row is mounted, so an entry from below clamps to it
		// rather than doing nothing on the unmounted last child.
		const last = deps.childList.isCollapsed?.() ? 0 : count - 1;
		const edge = entryEdge(offset);
		const child = deps.innerBlockRefs[edge.child === 'first' ? 0 : last];
		if (child) land(child, edge.offset);
	}

	function parkCaret(offset: number): void {
		walkInto(offset, (child, at) => child.parkCaret?.(at));
	}

	return {
		get editable() {
			return deps.editable ?? true;
		},
		focusable: true,
		focus: placeCaret(deps.selection, (offset) => walkInto(offset, (child, at) => child.focus(at))),
		parkCaret,
		getCursorOffset() {
			const focusEl = deps.getFocusEl?.();
			if (focusEl) return holdsWholeBlockFocus(focusEl, deps.inputProxy?.el()) ? 0 : null;
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
		childList: () => deps.childList,
		focusAtColumn(x: number, from: StickyColumnDirection) {
			// Whole-block focus has no column to land in, so a vertical entry focuses the block
			// itself, like the plain-arrow path.
			const focusEl = deps.getFocusEl?.();
			if (focusEl) {
				landFocus(focusEl);
				// Announced here because this branch reaches neither `placeCaret` nor a text block's
				// editable element, the two placements that announce for everything else.
				deps.selection.announceSelection();
				return;
			}
			if (deps.childList.count() === 0) return;
			dispatchFocusAtColumn(deps.innerBlockRefs, x, from);
		},
		isVerticallyTransparent(): boolean {
			return isVerticallyTransparentNode(deps.node, deps.reading.grammar);
		},
		enterEdgeWidget(side: 'start' | 'end'): boolean {
			const count = deps.childList.count();
			if (count === 0) return false;
			const edge = side === 'start' ? 0 : count - 1;
			return deps.innerBlockRefs[edge]?.enterEdgeWidget?.(side) ?? false;
		},
		measurePartialRects(start: number, end: number): DOMRect[] {
			// A childless container is one unit and measures its whole box. One with children
			// returns nothing; the overlay measures its children instead.
			if (deps.childList.count() > 0) return [];
			const box = deps.getBoxEl?.();
			if (!box || end <= start) return [];
			return [box.getBoundingClientRect()];
		}
	};
}
