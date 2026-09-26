/** The shared `BlockComponent` implementation for container blocks. */

import {
	CURSOR_END,
	CURSOR_EXACT_START,
	CURSOR_START,
	FOCUS_LAST_START,
	type BlockComponent,
	type ContainerBlockComponent,
	type StickyColumnDirection
} from '../block-component';
import {
	dispatchFocusByPath,
	dispatchFocusAtColumn,
	dispatchGetBlockComponentByPath
} from './focus/focus-dispatch';
import { revealChildOrWait, type RefSlots } from '../reactivity/publish-ref.svelte';
import type { AnyBlockKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import type { BlockEditActions, FocusActions } from '../action-contracts';
import { runGlobalChordOnKind, type GlobalCommandContext } from '../schema/commands';
import type { KeybindingOverrideMap } from '../schema/keybinding-overrides';
import type { PluginActivation } from '../schema/plugin-activation';
import type { Reading } from '../schema/reading';
import { isCharacterKey } from '../schema/keybindings';
import { displayLength, trimTrailingLineEnding } from '../core/lines';
import { isVerticallyTransparentNode } from '../core/inline/transparency';
import type { CaretMemory } from '../cursor/caret-memory';
import type { AnyCommandId } from '../schema/command-id';
import type { SelectionState } from '../selection/selection-state.svelte';
import { placeCaret } from '../selection/caret-doors';
import {
	focusWholeBlockEl,
	holdsWholeBlockFocus,
	type WholeBlockInputProxy
} from './whole-block-focus-surface';
import { devWarn } from '../dev-warn';

export interface EditorGlobalChordDeps extends Pick<
	GlobalCommandContext,
	'history' | 'pluginEditor' | 'onCommandError'
> {
	getKind: () => AnyBlockKind;
	getKeybindingOverrides: () => KeybindingOverrideMap | undefined;
	isReading: () => boolean;
	/** A whole-block component without it would consume an unlisted plugin's chord. */
	activation: PluginActivation;
}

/**
 * Undo and redo for a block focused as a whole: no inner leaf runs the global chords for it,
 * and the editor root declines while focus sits on the block. `true` means consumed, in
 * reading mode too, since skipping `dispatchKeyCommand` would otherwise hand a read-only
 * document the browser's native undo.
 */
export function handleEditorGlobalChord(chord: string, deps: EditorGlobalChordDeps): boolean {
	return runGlobalChordOnKind(chord, deps.getKind(), deps.getKeybindingOverrides(), {
		isReading: deps.isReading(),
		history: deps.history,
		pluginEditor: deps.pluginEditor,
		onCommandError: deps.onCommandError,
		activation: deps.activation
	});
}

export interface BlockEdgeExitDeps {
	getIndex: () => number;
	focus: Pick<FocusActions, 'moveFocus'>;
}

/**
 * The four plain-arrow exits out of a block, in the direction the key points. Shared by
 * whole-block focus and the plugin container's `moveFocusOut`, so a plugin editor that
 * reaches its own edge lands the same way the built-ins do. False for any other key.
 */
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
		if (!deps.isReading()) void deps.blockEdit.deleteBlock(deps.getIndex());
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
	if (cut && !deps.isReading()) void deps.blockEdit.deleteBlock(deps.getIndex());
}

export interface ContainerBlockComponentDeps {
	/** What the mounted component reports as `editable`, mirroring the kind's descriptor flag;
	 *  omitted stays `true`, the built-in containers' answer. A getter, never a snapshot. */
	readonly editable?: boolean;
	/** Ends a live cross-block range when `focus` places a caret: focusing a whole block
	 *  reaches no child to borrow it from. */
	readonly selection: SelectionState;
	readonly innerBlockRefs: (BlockComponent | undefined)[];
	/** The same list's ref slots: the array is for the dispatch walks, this is for waiting on
	 *  a mount, which needs an identity replacing the array cannot invalidate. */
	readonly refSlots: RefSlots<BlockComponent>;
	readonly nodeChildrenLength: number;
	/** For the widget-only check, which reads the node so it works for an unmounted
	 *  container where `innerBlockRefs` is sparse (VR-6). */
	readonly node: NodeView;
	/** How the editor reads its bytes, whose grammar the widget-only check reads the node in. */
	readonly reading: Reading;
	/** Scroll this container so child `index` is mounted; resolves after a tick. */
	readonly revealChild?: (index: number) => Promise<void>;
	/** Lets the scroll-into-view give up instead of hanging when a scroll missed (VR-5). */
	readonly isInWindow?: (index: number) => boolean;
	/** While true only the title row is mounted, so a focus entering the container at its
	 *  end clamps to that row rather than doing nothing on an unmounted child. */
	readonly isCollapsed?: () => boolean;
	/** Open this container so a scroll-into-view can descend into its hidden body, as a real
	 *  committed edit. Absent leaves it to stop on the title row. */
	readonly expandCollapsed?: () => Promise<boolean>;
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
		if (deps.nodeChildrenLength === 0) return;
		// Collapsed: only the title row is mounted, so an entry from below clamps to it
		// rather than doing nothing on the unmounted last child.
		const last = deps.isCollapsed?.() ? 0 : deps.nodeChildrenLength - 1;
		const entersFirst = offset === 0 || offset === CURSOR_START || offset === CURSOR_EXACT_START;
		const child = entersFirst ? deps.innerBlockRefs[0] : deps.innerBlockRefs[last];
		if (!child) return;
		if (offset === FOCUS_LAST_START) land(child, FOCUS_LAST_START);
		else if (entersFirst) land(child, offset);
		else land(child, CURSOR_END);
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
		getBlockComponentByPath(path: number[]): BlockComponent | null {
			return dispatchGetBlockComponentByPath(deps.innerBlockRefs, path);
		},
		async revealByPath(path: number[]): Promise<BlockComponent | null> {
			if (path.length === 0) return null;
			const [head, ...rest] = path;
			// Only a body target needs the container opened; the title row stays mounted.
			// Awaited because everything below must run against the post-commit tree.
			if (head >= 1 && deps.isCollapsed?.()) await deps.expandCollapsed?.();
			if (deps.revealChild) {
				await revealChildOrWait(head, {
					slots: deps.refSlots,
					childCount: deps.nodeChildrenLength,
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
			// Whole-block focus has no column to land in, so a vertical entry focuses the block
			// itself, like the plain-arrow path.
			const focusEl = deps.getFocusEl?.();
			if (focusEl) {
				landFocus(focusEl);
				// Announced here because this branch reaches neither `placeCaret` nor the
				// editable surface, the two placements that announce for everything else.
				deps.selection.announceSelection();
				return;
			}
			if (deps.nodeChildrenLength === 0) return;
			dispatchFocusAtColumn(deps.innerBlockRefs, x, from);
		},
		isVerticallyTransparent(): boolean {
			return isVerticallyTransparentNode(deps.node, deps.reading.grammar);
		},
		enterEdgeWidget(side: 'start' | 'end'): boolean {
			if (deps.nodeChildrenLength === 0) return false;
			const edge = side === 'start' ? 0 : deps.nodeChildrenLength - 1;
			return deps.innerBlockRefs[edge]?.enterEdgeWidget?.(side) ?? false;
		},
		measurePartialRects(start: number, end: number): DOMRect[] {
			// A childless container is one unit and measures its whole box. One with children
			// returns nothing; the overlay measures its children instead.
			if (deps.nodeChildrenLength > 0) return [];
			const box = deps.getBoxEl?.();
			if (!box || end <= start) return [];
			return [box.getBoundingClientRect()];
		}
	};
}
