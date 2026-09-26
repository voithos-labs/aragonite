/**
 * Editor-root presentation-mode switch: keep the caret across a mode change. The pre phase is
 * the last moment the outgoing mode owns the DOM (past it, the mode's render key has rebuilt
 * every block from its own CST bytes), so the caret is captured and the block blurred there;
 * the post phase drops the geometry the old markers set and puts the caret back through the
 * shared restore path. The two `$effect`s stay in `Editor.svelte`, a mode read plus one call.
 */

import { tick } from 'svelte';
import { isTextEntrySurface } from '../active-editor';
import { ambientLengthOf } from '../ambient/ambient-dom';
import { toClampedRawOffset } from '../cursor/coordinate-spaces';
import type { CaretMemory } from '../cursor/caret-memory';
import type { HeightOracle } from '../cursor/height-oracle';
import { domTextOffsetAtNode } from '../cursor/widget-offset';
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
	heightOracle: Pick<HeightOracle, 'dropMeasured'>;
	events: EditorEvents;
	/** The bare-mount restore path: a mode change only changes the view, so it writes no
	 *  scroll position. */
	restoreCaret(path: number[], offset: number): Promise<unknown>;
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
		const offset = toClampedRawOffset(
			domTextOffsetAtNode(contentEl, node, sel.focusOffset),
			ambientLengthOf(contentEl)
		);
		return { path, offset };
	}

	// A post-tick focus like every structural op's; the restore path clamps the saved offset to
	// one the caret can sit at in the new mode. Standing aside for a focused text field keeps
	// the restore from stealing a host field mid-typing.
	async function restoreAfterFlush(caret: FlipCaret, to: PresentationMode): Promise<void> {
		await tick();
		if (deps.mode !== to || isTextEntrySurface(document.activeElement)) return;
		await deps.restoreCaret(caret.path, caret.offset);
	}

	return {
		beforeFlip(to) {
			if (to === preFlipSeenMode) return;
			const from = preFlipSeenMode;
			preFlipSeenMode = to;
			// Reading keeps its entry snapshot: it has no caret of its own to recapture on the way out.
			if (from !== 'reading') flipCaret = captureCaret();
			// A mode change counts as a blur: showing markers or an in-progress composition closes
			// through the blur handling that already exists. The host's own header is exempt, or a
			// mode toggle would blur a title field mid-edit.
			const active = document.activeElement;
			if (
				active instanceof HTMLElement &&
				deps.editorEl?.contains(active) &&
				!deps.isHostChrome(active)
			) {
				active.blur();
				// A blur the editor performs announces the selection it drops: the document listener
				// only reports a range the browser still anchors in the root, and this one is gone.
				deps.announceSelection();
			}
		},
		afterFlip(to) {
			if (to === lastEffectiveMode) return;
			lastEffectiveMode = to;
			// Which markers paint just changed: how the caret arrived was recorded against the old
			// geometry, and every measured height is the other mode's. No width bump with it: focus
			// is gone, and a rebuild would lose the block held in place.
			deps.caretMemory.forget();
			deps.heightOracle.dropMeasured();
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
