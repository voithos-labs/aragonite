/**
 * The editable block behind `document.activeElement`, for the public entry points that address
 * it. A gap caret is refused: its stand-in element is not a block, and a nested gap's stand-in
 * sits inside its container's host, which must not receive what was aimed at the gap. Every rule
 * an entry point must apply (the reading-mode check, the paste pipeline) lives in the block.
 */

import type { BlockComponent } from '../../block-component';
import type { DocumentGetter } from '../../editor-keys';
import type { DocumentStamp, DocumentStamps } from '../../editor-actions/commit/document-stamp';
import type { InsertMarkdownOptions } from '../../editor-props';
import type { KindCommandTarget } from '../../schema/block-commands';
import { findSurfacePathForElement } from '../../selection/path-lookup';
import type { SelectionState } from '../../selection/selection-state.svelte';
import { blockNodeAt } from '../../tree-operations/node-primitives';
import { escapeMarkdownLiteral } from '../../tree-operations/paste/markdown-literal';

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
	/** The counter every byte write bumps (`editor-actions/commit/content-version.svelte.ts`). */
	contentVersion(): number;
	stamps: Pick<DocumentStamps, 'current'>;
}

export interface FocusedSurface {
	path(): number[] | null;
	/** Null for a gap caret's stand-in element; global commands still reach the dispatch,
	 *  exactly as the gap caret's own chord handling does. */
	commandTarget(): KindCommandTarget | null;
	/** Routed like a paste event, so the rules live in the block; `below` pastes into a new
	 *  paragraph after the top-level block. Resolves once the insert has landed. */
	insertMarkdown(md: string, options?: InsertMarkdownOptions): Promise<boolean>;
	/** An insert at the caret, aimed now at the focused block and document, for an insert that
	 *  waits on something first (a menu's clipboard read); null with no block to aim at. */
	aimInsertAtFocus(): AimedInsert | null;
	/** Pastes `md` as blocks into the paragraph `mint` opens and focuses, the paste route and one
	 *  undo entry seeded at `at`: a paste at a gap or on a block focused whole. */
	pasteAsBlocks(mint: () => Promise<boolean>, md: string, at: number[]): Promise<boolean>;
}

/** The focused block's two paste entries, each true only when bytes moved into its document. */
export interface AimedInsert {
	markdown(md: string): Promise<boolean>;
	plainText(text: string): Promise<boolean>;
}

export function createFocusedSurface(deps: FocusedSurfaceDeps): FocusedSurface {
	function path(): number[] | null {
		if (deps.selection.gapCaret) return null;
		const active = document.activeElement;
		if (!(active instanceof HTMLElement) || !deps.editorEl?.contains(active)) return null;
		return findSurfacePathForElement(active);
	}

	// True only when bytes moved into the document the insert was made for: a block answers for
	// the paste it handled, and a write the commit refused (reading mode, a swap) moves none.
	function aimAtFocus(madeFor: DocumentStamp): AimedInsert | null {
		const at = path();
		const block = at && deps.getBlockComponent(at);
		if (!block?.insertMarkdown) return null;
		const land = async (insert: () => boolean | Promise<boolean> | undefined) => {
			if (!madeFor.live) return false;
			const before = deps.contentVersion();
			const handled = (await insert()) ?? false;
			return handled && madeFor.live && deps.contentVersion() !== before;
		};
		return {
			markdown: (md) => land(() => block.insertMarkdown?.(md)),
			// A block that never says how it takes text literally gets the prose answer, escaped.
			plainText: (text) =>
				land(() =>
					block.insertPlainText
						? block.insertPlainText(text)
						: block.insertMarkdown?.(escapeMarkdownLiteral(text))
				)
		};
	}

	const insertAtFocus = (md: string, madeFor: DocumentStamp): Promise<boolean> =>
		aimAtFocus(madeFor)?.markdown(md) ?? Promise.resolve(false);

	/** Pastes into the paragraph `mint` opens, one undo entry with it; reading mode opens none. */
	async function insertIntoNew(
		mint: () => Promise<boolean>,
		md: string,
		at: number[],
		madeFor: DocumentStamp
	): Promise<boolean> {
		if (deps.isReading()) return false;
		let inserted = false;
		await deps.undoStep(at, 0, async () => {
			if (await mint()) inserted = await insertAtFocus(md, madeFor);
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
			// Made for the document in place now, so a swap or an unmount before it lands refuses it.
			const madeFor = deps.stamps.current();
			if (options?.placement !== 'below') return insertAtFocus(md, madeFor);
			const at = path();
			if (!at || !deps.getBlockComponent(at)?.insertMarkdown) return Promise.resolve(false);
			const topIndex = at[0];
			return insertIntoNew(() => deps.insertParagraph(topIndex + 1, ''), md, [topIndex], madeFor);
		},
		aimInsertAtFocus: () => aimAtFocus(deps.stamps.current()),
		pasteAsBlocks: (mint, md, at) => insertIntoNew(mint, md, at, deps.stamps.current())
	};
}
