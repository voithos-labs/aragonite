/**
 * Keeps the caret across a presentation-mode switch. `beforeFlip` captures the caret and blurs
 * the block while the outgoing mode still owns the DOM; `afterFlip` drops the outgoing markers'
 * geometry and restores the caret through the shared restore path.
 */

import { tick } from 'svelte';
import { isTextEntrySurface } from '../active-editor';
import type { CaretMemory } from '../cursor/caret-memory';
import type { LayoutState } from '../windowing/layout-state.svelte';
import type { MenuPresence } from './menu/menu-presence.svelte';
import type { DraftRegistry } from './draft-registry';
import { rawOffsetAt } from '../cursor/widget-offset';
import type { EditorEvents } from '../editor-events';
import type { BlockElLookup } from '../editor-keys';
import type { PresentationMode } from '../presentation-mode';
import { findSurfacePathForElement } from '../selection/path-lookup';
import type { EditorSelection } from '../selection/primitives';
import type { SelectionState } from '../selection/selection-state.svelte';

export interface ModeFlipDeps {
	/** Getters, never values: the root binds after construction and the mode moves. */
	get editorEl(): HTMLElement | undefined;
	get mode(): PresentationMode;
	selection: Pick<SelectionState, 'isCrossBlock' | 'gapCaret' | 'clearGapCaret'>;
	/** The public snapshot, which also answers for a native caret no block reports. */
	getSelection(): EditorSelection | null;
	/** Sends the current selection to subscribers. */
	announceSelection(): void;
	getBlockElByPath: BlockElLookup;
	isHostChrome(node: Node | null): boolean;
	caretMemory: Pick<CaretMemory, 'forget'>;
	layout: Pick<LayoutState, 'forgetMeasuredHeights'>;
	menus: Pick<MenuPresence, 'closeAll'>;
	/** The blur in `beforeFlip` already committed the focused draft, which ended it, so this
	 *  close reaches only a draft nothing focused and writes each draft at most once. */
	drafts: Pick<DraftRegistry, 'closeAll'>;
	events: EditorEvents;
	/** The bare-mount restore path: a mode change only changes the view, so it writes no
	 *  scroll position. */
	restoreCaret(path: number[], offset: number): Promise<unknown>;
	/** Make the editor's reading answer `mode` (null: the requested mode again), so an edit the
	 *  blur commits lands in the mode it was typed in. */
	holdOutgoingMode(mode: PresentationMode | null): void;
}

export interface ModeFlip {
	/** The `$effect.pre` half, run untracked: capture and blur while the outgoing mode still
	 *  owns the DOM. */
	beforeFlip(to: PresentationMode): void;
	/** The `$effect` half: reset mode-bound geometry, then restore the caret after the flush. */
	afterFlip(to: PresentationMode): void;
}

interface FlipCaret {
	path: number[];
	offset: number;
}

export function createModeFlip(deps: ModeFlipDeps): ModeFlip {
	let flipCaret: FlipCaret | null = null;
	let preFlipSeenMode = deps.mode;
	let lastEffectiveMode = deps.mode;

	/** The focused block's caret as (path, raw offset): the block's own answer while it holds
	 *  focus, else the native range a toggle click leaves behind while the button has focus. */
	function captureCaret(): FlipCaret | null {
		if (deps.selection.isCrossBlock || deps.selection.gapCaret) return null;
		const focused = deps.getSelection()?.focus;
		if (focused) return { path: focused.path, offset: focused.offset };
		const sel = window.getSelection();
		const node = sel?.focusNode;
		if (!node || !deps.editorEl?.contains(node) || deps.isHostChrome(node)) return null;
		const el = node instanceof Element ? node : node.parentElement;
		const path = findSurfacePathForElement(el);
		if (!path) return null;
		const contentEl = deps.getBlockElByPath(path);
		if (!contentEl?.contains(node)) return null;
		const offset = rawOffsetAt(contentEl, node, sel.focusOffset);
		return { path, offset };
	}

	// The restore path clamps the offset to one the new mode allows; a focused text field is
	// left alone, so the restore cannot steal a host field mid-typing.
	async function restoreAfterFlush(caret: FlipCaret, to: PresentationMode): Promise<void> {
		await tick();
		if (deps.mode !== to || isTextEntrySurface(document.activeElement)) return;
		await deps.restoreCaret(caret.path, caret.offset);
	}

	// A mode change blurs the block, so revealed markers and a composition close as on any blur;
	// the host's header is exempt.
	function blurForFlip(): void {
		const active = document.activeElement;
		if (!(active instanceof HTMLElement) || !deps.editorEl?.contains(active)) return;
		if (deps.isHostChrome(active)) return;
		active.blur();
		// A blur the editor performs announces the selection it drops: the document listener only
		// reports a range the browser still anchors in the root, and this one is gone.
		deps.announceSelection();
	}

	return {
		beforeFlip(to) {
			if (to === preFlipSeenMode) return;
			const from = preFlipSeenMode;
			preFlipSeenMode = to;
			deps.holdOutgoingMode(from);
			try {
				// Reading keeps its entry snapshot: it has no caret of its own to recapture on the way out.
				if (from !== 'reading') flipCaret = captureCaret();
				blurForFlip();
			} finally {
				deps.holdOutgoingMode(null);
			}
		},
		afterFlip(to) {
			if (to === lastEffectiveMode) return;
			lastEffectiveMode = to;
			// A menu opened in one mode offers that mode's edits. First, since a close may write, and
			// the caret restore below must read the tree it leaves.
			deps.menus.closeAll('mode-change');
			deps.drafts.closeAll('mode-change');
			// The caret memory and measured heights belong to the outgoing mode's markers.
			deps.caretMemory.forget();
			deps.layout.forgetMeasuredHeights();
			if (to === 'reading') {
				// The gap caret is the editor's own, not the browser's, so no blur reaches it:
				// the mode change clears it rather than each entry path.
				deps.selection.clearGapCaret();
			} else if (flipCaret) {
				const caret = flipCaret;
				flipCaret = null;
				void restoreAfterFlush(caret, to);
			}
			deps.events.emit('presentationModeChange', to);
		}
	};
}
