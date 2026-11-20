/**
 * The editable block behind `document.activeElement`, for the public entry points that address
 * it. A gap caret is refused: its stand-in element is not a block, and a nested gap's stand-in
 * sits inside its container's host, which must not receive what was aimed at the gap.
 */

import type { BlockComponent } from '../../block-component';
import type { DocumentGetter } from '../../editor-keys';
import type { KindCommandTarget } from '../../schema/block-commands';
import { findSurfacePathForElement } from '../../selection/path-lookup';
import type { SelectionState } from '../../selection/selection-state.svelte';
import { blockNodeAt } from '../../tree-operations/node-primitives';

export interface FocusedSurfaceDeps {
	/** A getter, never a value: the root binds after construction. */
	get editorEl(): HTMLElement | undefined;
	selection: Pick<SelectionState, 'gapCaret'>;
	getDoc: DocumentGetter;
	getBlockComponent(path: number[]): BlockComponent | null;
}

export interface FocusedSurface {
	path(): number[] | null;
	/** Null for a gap caret's stand-in element; global commands still reach the dispatch,
	 *  exactly as the gap caret's own chord handling does. */
	commandTarget(): KindCommandTarget | null;
}

export function createFocusedSurface(deps: FocusedSurfaceDeps): FocusedSurface {
	function path(): number[] | null {
		if (deps.selection.gapCaret) return null;
		const active = document.activeElement;
		if (!(active instanceof HTMLElement) || !deps.editorEl?.contains(active)) return null;
		return findSurfacePathForElement(active);
	}

	return {
		path,
		commandTarget() {
			const at = path();
			if (!at) return null;
			const component = deps.getBlockComponent(at);
			const node = blockNodeAt(deps.getDoc(), at);
			if (!component || !node) return null;
			const { runCommand, isCommandActive, afterSourceCommit, afterSelectionRemoved } = component;
			return {
				kind: node.kind,
				runCommand: runCommand && ((id, arg, run) => runCommand.call(component, id, arg, run)),
				isCommandActive: isCommandActive && ((id) => isCommandActive.call(component, id)),
				getPath: () => at,
				afterSourceCommit: afterSourceCommit && ((run) => afterSourceCommit.call(component, run)),
				afterSelectionRemoved:
					afterSelectionRemoved && ((run) => afterSelectionRemoved.call(component, run))
			};
		}
	};
}
