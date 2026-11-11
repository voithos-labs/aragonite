/**
 * The `source` prop's whole-document replacement. Every piece of per-document state resets here
 * in one fixed order, so a swap cannot skip a step.
 */

import type { Document } from '../../core/nodes';
import type { GrammarView } from '../../schema/block-openers';
import { definitionsOf, type LinkReferenceResolver } from '../../core/inline/scan/definitions';
import type { CaretMemory } from '../../caret/caret-memory';
import type { LayoutState } from '../../windowing/layout-state.svelte';
import type { SelectionState } from '../../selection/selection-state.svelte';
import { emptyParagraph } from '../../tree-operations';
import { readAsOpened } from '../../schema/opened-reading';
import type { UndoManager } from '../../undo/types';
import type { EditorEvents } from '../../editor-events';
import type { MenuPresence } from '../menu/menu-presence.svelte';
import type { DraftRegistry } from '../../editor-actions/commit/draft-registry.svelte';
import type { DocumentStamps } from '../../editor-actions/commit/document-stamp';
import type { KeptStarts } from '../../editor-actions/commit/kept-starts';
import type { MarkHoverTracker } from '../../decorations/mark-hover';
import { startsAlone } from '../../editor-actions/commit/reading-write-gate';

export interface ParsedDocument {
	doc: Document;
	resolver: LinkReferenceResolver;
	signature: string;
}

/** The parse every document goes through, at mount and at each swap, in the editor's grammar. */
export function initDocument(source: string, grammar: GrammarView): ParsedDocument {
	const doc = readAsOpened(source, { grammar, scope: 'document' });
	if (doc.children.length === 0) {
		// Only the empty source parses to zero blocks (a blank line is a block of its own), so
		// there is no authored ending to inherit and LF is the whole answer.
		doc.children.push(emptyParagraph('', '\n'));
	}
	const refs = definitionsOf(doc.children);
	return { doc, resolver: refs.resolve, signature: refs.signature };
}

export interface DocumentSwapDeps {
	grammar: GrammarView;
	/** The text the editor holds now, the same string `getSource()` returns. */
	currentSource(): string;
	/** Ends the typing batch: it groups the outgoing document's undo steps, which go with it. */
	flushDebouncedCheckpoint(): void;
	/** Retired first: from here on, a write made for the outgoing document is refused. */
	stamps: Pick<DocumentStamps, 'retire'>;
	/** Then dropped, so a block the swap tears down blurs without trying to commit its draft. */
	drafts: Pick<DraftRegistry, 'closeAll'>;
	/** A hovered mark belongs to the outgoing document; ended while that document is still the
	 *  one a host's handler reads. */
	markHover: Pick<MarkHoverTracker, 'end'>;
	/** Called before the tree changes, so a caret landing still waiting gives up. */
	noteTreeSwap(): void;
	/** Writes the tree into the `$state` root and re-keys its blocks. */
	adoptDocument(doc: Document): void;
	/** The window the tree changes in, as every byte writer's does; its close announces the bytes. */
	starts: Pick<KeptStarts, 'duringWrite' | 'writing'>;
	clearBlockRefs(): void;
	layout: Pick<LayoutState, 'forgetMeasuredHeights'>;
	undoManager: Pick<UndoManager, 'clear'>;
	caretMemory: Pick<CaretMemory, 'forget'>;
	/** Every open menu acts on a block or bytes of the outgoing document. Closed before the
	 *  blocks unmount, which a menu may react to. */
	menus: Pick<MenuPresence, 'closeAll'>;
	selection: Pick<SelectionState, 'batch' | 'clear' | 'announceSelection'>;
	/** Unconditional: the outgoing resolver closes over the swapped-out document. */
	adoptLinkReferences(resolver: LinkReferenceResolver, signature: string): void;
	events: Pick<EditorEvents, 'emit'>;
}

export interface DocumentSwap {
	/** Replaces the document, unless `source` is the text it already holds: a host echoing
	 *  `getSource()` back keeps its undo history. */
	swapTo(source: string): void;
	/** Counts whole-document replacements, which `editEpoch` cannot tell from a keystroke. */
	generation(): number;
}

export function createDocumentSwap(deps: DocumentSwapDeps): DocumentSwap {
	// Plain, never reactive: the code that reads it runs inside decoration `provide`, which
	// must register no dependency.
	let generation = 0;

	return {
		swapTo(source) {
			if (source === deps.currentSource() || !startsAlone(deps)) return;
			replace(source);
			// Last, so a subscriber reading the document sees the new tree, selection and resolver.
			deps.events.emit('sourceSwap', { generation });
		},
		generation: () => generation
	};

	function replace(source: string): void {
		deps.stamps.retire();
		deps.drafts.closeAll('document-swap');
		deps.markHover.end();
		deps.flushDebouncedCheckpoint();
		deps.noteTreeSwap();
		const reset = initDocument(source, deps.grammar);
		deps.starts.duringWrite(() => {
			deps.adoptDocument(reset.doc);
			return { touched: null };
		});
		deps.clearBlockRefs();
		// Block ids never recur, so every measured height belongs to a block that can't come back.
		deps.layout.forgetMeasuredHeights();
		deps.undoManager.clear();
		deps.caretMemory.forget();
		deps.menus.closeAll('document-swap');
		// Announced explicitly: on a native-only caret the clear sees no change, and subscribers
		// would keep the outgoing document's selection. Batched, so a real range emits once.
		deps.selection.batch(() => {
			deps.selection.clear();
			deps.selection.announceSelection();
		});
		generation++;
		deps.adoptLinkReferences(reset.resolver, reset.signature);
	}
}
