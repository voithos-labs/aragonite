/**
 * The editable block behind `document.activeElement`, for the public entry points that address
 * it. A gap caret is refused: its stand-in element is not a block, and a nested gap's stand-in
 * sits inside its container's host, which must not receive what was aimed at the gap. Every rule
 * an entry point must apply (the reading-mode check, the paste pipeline) lives in the block.
 */

import type { BlockComponent } from '../block-component';
import type { DocumentGetter } from '../editor-keys';
import type { InsertMarkdownOptions } from '../editor-props';
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
	isReading(): boolean;
	/** Makes an empty top-level paragraph at `boundary` and focuses it. */
	insertParagraph(boundary: number, text: string): void | Promise<void>;
}

export interface FocusedSurface {
	path(): number[] | null;
	/** Null for a gap caret's stand-in element or a block that runs no commands; global commands
	 *  still reach the dispatch, exactly as the gap caret's own chord handling does. */
	commandTarget(): KindCommandTarget | null;
	/** Routed the way a paste event is: transforms, delete-first, one undo entry and focus
	 *  all live in the block. `below` pastes into a new paragraph after the top-level block. */
	insertMarkdown(md: string, options?: InsertMarkdownOptions): boolean;
}

export function createFocusedSurface(deps: FocusedSurfaceDeps): FocusedSurface {
	function path(): number[] | null {
		if (deps.selection.gapCaret) return null;
		const active = document.activeElement;
		if (!(active instanceof HTMLElement) || !deps.editorEl?.contains(active)) return null;
		return findSurfacePathForElement(active);
	}

	function insertAtFocus(md: string): boolean {
		const at = path();
		if (!at) return false;
		return deps.getBlockComponent(at)?.insertMarkdown?.(md) ?? false;
	}

	async function insertBelow(topIndex: number, md: string): Promise<void> {
		await deps.insertParagraph(topIndex + 1, '');
		insertAtFocus(md);
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
		insertMarkdown(md, options) {
			if (options?.placement !== 'below') return insertAtFocus(md);
			const at = path();
			if (!at || deps.isReading() || !deps.getBlockComponent(at)?.insertMarkdown) return false;
			void insertBelow(at[0], md);
			return true;
		}
	};
}
