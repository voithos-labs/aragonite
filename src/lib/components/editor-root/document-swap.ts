/**
 * The whole-document replacement a `source` prop or the handle's `load` makes, and the re-read of
 * the same bytes a changed plugin list makes. The incoming bytes are read first, so a read that
 * throws changes nothing;
 * then every piece of per-document state resets in one fixed order, so neither can skip a step.
 */

import type { Document } from '../../core/nodes';
import type { DocumentView } from '../../core/node-views';
import { captureChange, changeAfter } from '../../editor-actions/commit/change-record';
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
	/** The tree the editor holds now, which a re-read records its change against. */
	doc(): DocumentView;
	/** Ends the typing batch: it groups the outgoing document's undo steps, which go with it. */
	flushDebouncedCheckpoint(): void;
	/** Retired first at a swap: from here on, a write made for the outgoing document is refused. */
	stamps: Pick<DocumentStamps, 'retire'>;
	/** Then closed, so a block the swap tears down blurs without trying to commit its draft. A
	 *  re-read keeps a waiting `edit()` and tells it the bytes stayed. */
	drafts: Pick<DraftRegistry, 'closeAll' | 'watching' | 'record'>;
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
	/** Replaces the document with `source` whatever it holds, as the handle's `load` asks. */
	load(source: string): void;
	/** Reads the same bytes again under a changed grammar, keeping the undo history. */
	reparse(): void;
	/** Counts whole-document replacements, which `editEpoch` cannot tell from a keystroke. */
	generation(): number;
}

export function createDocumentSwap(deps: DocumentSwapDeps): DocumentSwap {
	// Plain, never reactive: the code that reads it runs inside decoration `provide`, which
	// must register no dependency.
	let generation = 0;

	function replace(source: string): void {
		adopt(() => source, 'clear');
		generation++;
		// Last, so a subscriber reading the document sees the new tree, selection and resolver.
		deps.events.emit('sourceSwap', { generation });
	}

	return {
		swapTo(source) {
			if (source !== deps.currentSource() && startsAlone(deps)) replace(source);
		},
		load(source) {
			if (startsAlone(deps)) replace(source);
		},
		reparse() {
			if (startsAlone(deps)) adopt(deps.currentSource, 'keep');
		},
		generation: () => generation
	};

	function adopt(incoming: () => string, history: 'clear' | 'keep'): void {
		const source = incoming();
		let reset = initDocument(source, deps.grammar);
		// A re-read keeps the bytes, so a write waiting on them still lands.
		if (history === 'clear') deps.stamps.retire();
		deps.drafts.closeAll('document-swap');
		deps.markHover.end();
		deps.flushDebouncedCheckpoint();
		deps.noteTreeSwap();
		// A handler of the outgoing document may have written as it ended; a re-read reads that too.
		if (incoming() !== source) reset = initDocument(incoming(), deps.grammar);
		// Only a re-read still has a draft open here: a swap's all closed above.
		const capture = deps.drafts.watching() ? captureChange(deps.doc(), null) : null;
		deps.starts.duringWrite(() => {
			deps.adoptDocument(reset.doc);
			if (capture) deps.drafts.record(changeAfter(deps.doc(), capture, null));
			return { touched: null };
		});
		deps.clearBlockRefs();
		// Block ids never recur, so every measured height belongs to a block that can't come back.
		deps.layout.forgetMeasuredHeights();
		if (history === 'clear') deps.undoManager.clear();
		deps.caretMemory.forget();
		deps.menus.closeAll('document-swap');
		// Announced explicitly: on a native-only caret the clear sees no change, and subscribers
		// would keep the outgoing document's selection. Batched, so a real range emits once.
		deps.selection.batch(() => {
			deps.selection.clear();
			deps.selection.announceSelection();
		});
		deps.adoptLinkReferences(reset.resolver, reset.signature);
	}
}
