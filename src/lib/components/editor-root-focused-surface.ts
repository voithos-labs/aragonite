/**
 * The editing surface behind `document.activeElement`, for the public entry points that address it.
 * A gap caret declines: its proxy is not a block, and a NESTED gap's proxy sits inside its
 * container's host, which must not receive what was aimed at the gap. Every rule an entry point
 * must apply (the reading gate, the paste pipeline) lives in the editable it resolves.
 */

import type { BlockComponent } from '../block-component';
import type { DocumentGetter } from '../editor-keys';
import type { KindCommandTarget } from '../schema/block-commands';
import { findSurfacePathForElement } from '../selection/path-lookup';
import type { SelectionState } from '../selection/selection-state.svelte';
import { blockNodeAt } from '../tree-operations/node-primitives';

export interface FocusedSurfaceDeps {
	/** A getter, never a value: the root binds after construction. */
	get editorEl(): HTMLElement | undefined;
	selection: Pick<SelectionState, 'gapCaret'>;
	getDoc: DocumentGetter;
	getBlockComponent(path: number[]): BlockComponent | null;
}

export interface FocusedSurface {
	path(): number[] | null;
	/** Null for a gap caret's proxy or a block that runs no commands; global commands still
	 *  reach the command dispatch, exactly as the gap caret's own chord proxy does. */
	commandTarget(): KindCommandTarget | null;
	/** Routed the way a paste event is: transforms, delete-first, one undo entry and focus
	 *  all live in the surface. */
	insertMarkdown(md: string): boolean;
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
			if (!component?.runCommand || !node) return null;
			return {
				kind: node.kind,
				runCommand: (id, arg) => component.runCommand!(id, arg),
				isCommandActive: component.isCommandActive
					? (id) => component.isCommandActive!(id)
					: undefined
			};
		},
		insertMarkdown(md) {
			const at = path();
			if (!at) return false;
			return deps.getBlockComponent(at)?.insertMarkdown?.(md) ?? false;
		}
	};
}
