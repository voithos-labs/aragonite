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
	insertParagraph(boundary: number, text: string): Promise<boolean>;
	/** One undo entry for the paragraph `below` makes and the paste into it. */
	undoStep(path: number[], offset: number, run: () => Promise<unknown>): Promise<void>;
	/** The counter every byte write bumps (`reactivity/content-version.svelte.ts`). */
	contentVersion(): number;
}

export interface FocusedSurface {
	path(): number[] | null;
	/** Null for a gap caret's stand-in element; global commands still reach the dispatch,
	 *  exactly as the gap caret's own chord handling does. */
	commandTarget(): KindCommandTarget | null;
	/** Routed like a paste event, so the rules live in the block; `below` pastes into a new
	 *  paragraph after the top-level block. Resolves once the insert has landed. */
	insertMarkdown(md: string, options?: InsertMarkdownOptions): Promise<boolean>;
}

export function createFocusedSurface(deps: FocusedSurfaceDeps): FocusedSurface {
	function path(): number[] | null {
		if (deps.selection.gapCaret) return null;
		const active = document.activeElement;
		if (!(active instanceof HTMLElement) || !deps.editorEl?.contains(active)) return null;
		return findSurfacePathForElement(active);
	}

	// True only when bytes moved: a block answers for the paste it handled, and a write the
	// commit then refused (a switch to reading mid-insert) moves none.
	async function insertAtFocus(md: string): Promise<boolean> {
		const at = path();
		if (!at) return false;
		const before = deps.contentVersion();
		const handled = (await deps.getBlockComponent(at)?.insertMarkdown?.(md)) ?? false;
		return handled && deps.contentVersion() !== before;
	}

	async function insertBelow(topIndex: number, md: string): Promise<boolean> {
		let inserted = false;
		await deps.undoStep([topIndex], 0, async () => {
			await deps.insertParagraph(topIndex + 1, '');
			inserted = await insertAtFocus(md);
		});
		return inserted;
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
		},
		insertMarkdown(md, options) {
			if (options?.placement !== 'below') return insertAtFocus(md);
			const at = path();
			if (!at || deps.isReading() || !deps.getBlockComponent(at)?.insertMarkdown) {
				return Promise.resolve(false);
			}
			return insertBelow(at[0], md);
		}
	};
}
