/**
 * The `source` prop's whole-document replacement. Every piece of per-document state resets here
 * in one fixed order, so a swap cannot skip a step.
 */

import type { Document } from '../core/nodes';
import { readBlocks } from '../core/parser';
import type { GrammarView } from '../schema/block-openers';
import {
	buildLinkReferenceMap,
	type LinkReferenceResolver
} from '../core/inline/link-reference-resolver';
import type { EdgeAffinityState } from '../cursor/edge-affinity';
import type { HeightOracle } from '../cursor/height-oracle';
import type { StickyColumnState } from '../cursor/sticky-column';
import type { SelectionState } from '../selection/selection-state.svelte';
import { emptyParagraph, ensureEditableContainers } from '../tree-operations';
import type { UndoManager } from '../undo/types';
import type { EditorEvents } from '../editor-events';
import type { WidgetSelectionState } from './image/widget-selection-state.svelte';

export interface ParsedDocument {
	doc: Document;
	resolver: LinkReferenceResolver;
	signature: string;
}

/** The parse every document goes through, at mount and at each swap, in the editor's grammar. */
export function initDocument(source: string, grammar: GrammarView): ParsedDocument {
	const doc = readBlocks(source, { grammar, scope: 'document' });
	if (doc.children.length === 0) {
		// Only the empty source parses to zero blocks (a blank line is a block of its own), so
		// there is no authored ending to inherit and LF is the whole answer.
		doc.children.push(emptyParagraph('', '\n'));
	}
	for (const child of doc.children) ensureEditableContainers(child);
	const refs = buildLinkReferenceMap(doc.children);
	return { doc, resolver: refs.resolve, signature: refs.signature };
}

export interface DocumentSwapDeps {
	grammar: GrammarView;
	/** A pending typing batch belongs to the outgoing document, so it flushes while its path
	 *  still resolves; left running, the timer would apply note A's path to note B. */
	flushDebouncedCheckpoint(): void;
	/** Writes the tree into the `$state` root and re-keys its blocks. */
	adoptDocument(doc: Document): void;
	bumpContentVersion(): void;
	clearBlockRefs(): void;
	heightOracle: Pick<HeightOracle, 'dropMeasured'>;
	undoManager: Pick<UndoManager, 'clear'>;
	stickyColumn: Pick<StickyColumnState, 'reset'>;
	edgeAffinity: Pick<EdgeAffinityState, 'reset'>;
	/** Every menu Editor owns acts on a block or bytes of the outgoing document; a block's own
	 *  menus unmount with it. Closed before the blocks unmount, which a menu may react to. */
	closeMenus(): void;
	widgetSelection: Pick<WidgetSelectionState, 'clear'>;
	selection: Pick<SelectionState, 'batch' | 'clear' | 'announceSelection'>;
	/** Unconditional: the outgoing resolver closes over the swapped-out document. */
	adoptLinkReferences(resolver: LinkReferenceResolver, signature: string): void;
	events: Pick<EditorEvents, 'emit'>;
}

export interface DocumentSwap {
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
			deps.flushDebouncedCheckpoint();
			const reset = initDocument(source, deps.grammar);
			deps.adoptDocument(reset.doc);
			deps.bumpContentVersion();
			deps.clearBlockRefs();
			// Block ids never recur, so every measured height belongs to a block that cannot come
			// back: the block lists go back to estimates exactly as they do on first load.
			deps.heightOracle.dropMeasured();
			deps.undoManager.clear();
			deps.stickyColumn.reset();
			deps.edgeAffinity.reset();
			deps.closeMenus();
			deps.widgetSelection.clear();
			// Announced, not left to the clear: the swap usually arrives on a native-only caret, so
			// nothing editor-owned moves and subscribers would keep painting the outgoing document's
			// selection. Batched, so a real range still emits once.
			deps.selection.batch(() => {
				deps.selection.clear();
				deps.selection.announceSelection();
			});
			generation++;
			deps.adoptLinkReferences(reset.resolver, reset.signature);
			// Last, so a subscriber reading the document sees the new tree, selection and resolver.
			deps.events.emit('sourceSwap', { generation });
		},
		generation: () => generation
	};
}
