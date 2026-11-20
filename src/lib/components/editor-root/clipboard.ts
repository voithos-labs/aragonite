/**
 * Editor-root clipboard routing: copy and cut for a range across blocks or a selected widget that
 * no block handled. Where the selection's end holds no text position, Chromium dispatches at
 * `document.body` and Firefox at whatever block element holds it. The reading-mode checks live in
 * the handlers each route calls into, not here. A paste is `paste.ts`'s.
 */

import { claimsBodyChord, isTextEntrySurface } from '../../active-editor';
import type { BlockComponent } from '../../block-component';
import type { DocumentGetter } from '../../editor-keys';
import type { SelectionState } from '../../selection/selection-state.svelte';
import type { CrossBlockHandlers } from '../../selection/cross-block/dispatch';
import { runClipboardCut, takeArm, takeCopy } from '../blocks/editable/clipboard-step';
import { crossBlockClipboardArm } from '../../selection/cross-block/clipboard';
import { isWholeBlockInputProxy } from '../../selection/whole-block-input';
import type { MenuTake } from '../menu/clipboard-actions';

export interface EditorRootClipboardDeps {
	selection: SelectionState;
	getDoc: DocumentGetter;
	crossBlock: CrossBlockHandlers;
	/** The mounted block at `path`, which takes a selected widget's clipboard events. */
	getBlockComponent(path: number[]): BlockComponent | null;
	/** Whether `node` is in the host's header, whose fields keep their own clipboard. */
	isHostChrome(node: Node | null): boolean;
}

export interface EditorRootClipboard {
	/** `root` is the element the installing effect captured, not a live binding. */
	handleCopy(event: ClipboardEvent, root: HTMLElement): void;
	handleCut(event: ClipboardEvent, root: HTMLElement): void;
	/** A menu's Cut or Copy of the range the editor holds, taken as Ctrl+C takes it; null for
	 *  anything else, which the browser's own command copies. */
	takeForMenu(): MenuTake | null;
}

/** The two states whose events land here, in the order they are tried. */
type RootClipboardTarget = { arm: 'widget'; block: BlockComponent } | { arm: 'cross-block' };

export function createEditorRootClipboard(deps: EditorRootClipboardDeps): EditorRootClipboard {
	const crossBlockArms = [
		crossBlockClipboardArm({
			selection: deps.selection,
			getDoc: deps.getDoc,
			crossBlock: deps.crossBlock
		})
	];

	/** Inside this root, or on the body with this instance holding the chord; a text field other
	 *  than a block's whole-block input, and the host's header, keep their own clipboard. */
	function aimedAtRoot(root: HTMLElement, target: EventTarget | null): boolean {
		if (target === null || target === root.ownerDocument.body) return claimsBodyChord(root);
		if (!(target instanceof Node) || !root.contains(target)) return false;
		if (target instanceof Element && isTextEntrySurface(target) && !isWholeBlockInputProxy(target))
			return false;
		return !deps.isHostChrome(target);
	}

	/** A block marks an event it handled with `defaultPrevented`. The selection state holds a
	 *  widget or a range, never both, so their order does not matter. */
	function targetOf(event: ClipboardEvent, root: HTMLElement): RootClipboardTarget | null {
		if (event.defaultPrevented) return null;
		if (!aimedAtRoot(root, event.target)) return null;
		const widget = deps.selection.widget;
		const block = widget && deps.getBlockComponent(widget.paragraphPath);
		if (block) return { arm: 'widget', block };
		return deps.selection.ownsRange ? { arm: 'cross-block' } : null;
	}

	return {
		handleCopy(event, root) {
			const target = targetOf(event, root);
			if (!target) return;
			if (target.arm === 'widget') target.block.claimRootClipboard?.(event);
			else if (takeCopy(event, crossBlockArms)) event.preventDefault();
		},
		handleCut(event, root) {
			const target = targetOf(event, root);
			if (!target) return;
			if (target.arm === 'widget') target.block.claimRootClipboard?.(event);
			else void runClipboardCut(event, crossBlockArms);
		},
		takeForMenu() {
			if (!deps.selection.ownsRange || deps.selection.widget) return null;
			const taken = takeArm(crossBlockArms);
			if (!taken || !taken.take.write.text) return null;
			return { write: taken.take.write, remove: async () => taken.arm.remove(taken.take.held) };
		}
	};
}
