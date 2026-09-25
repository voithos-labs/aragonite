import type { UndoEntryMode } from '../action-contracts';
import { isBuiltinBlockKind, type AnyBlockKind, type CstNode, type Document } from '../core/nodes';
import type { PresentationMode } from '../presentation-mode';
import type { InlineResolverRef } from '../schema/inline-construct-policy';
import type { GrammarView } from '../schema/block-openers';
import type { PasteCommitCoordinator } from './paste/paste-deps';
import type { PluginActivation } from '../schema/plugin-activation';
import { createPluginRegistry } from '../schema/plugin-registry';
import { pluginKindOwner } from '../schema/plugin-kind';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PasteRange {
	start: number;
	end: number;
}

/**
 * What the join cleanup needs from the caller: the paste's delete half is a join, and in live
 * mode the delimiter runs it strands are bytes the user never saw. Absent leaves the cut
 * byte-literal, which is every non-live mode's answer anyway.
 */
export interface PasteSeam {
	presentationMode: PresentationMode | undefined;
	linkRef: InlineResolverRef;
	/** The editor's grammar, which a hook's reparse of the split halves reads; the dispatch
	 *  fills it from its own context, so a hook sees it even where the caller sent no join context. */
	grammar?: GrammarView;
}

export interface InlinePasteResult {
	/** New raw for the target node (including trailing line ending). */
	newRaw: string;
	caretOffset: number;
}

export interface StructuralPasteResult {
	replacement: CstNode[];
	focusReplacementIndex: number;
	focusOffset: number;
}

export interface ScopedStructuralPasteInput {
	doc: Document;
	targetPath: number[];
	/** Pasted blocks, blank-line-materialized. */
	blocks: CstNode[];
	controller: PasteCommitCoordinator;
	undoEntry: UndoEntryMode;
	/** The instance grammar the splice's `bodyWrite` escape reparses in. */
	grammar: GrammarView;
}

export interface PasteSurface {
	kind: AnyBlockKind;
	/**
	 * This kind's editable element holds text, never blocks (a table cell), so a blank block at
	 * the clipboard's edge is the copy's packaging: it neither picks the route nor lands in a
	 * structural splice.
	 */
	blankEdgesArePackaging?: boolean;
	/** Splice `text` into `node` at `offset` (optionally pre-deleting a range). Pure. */
	onInlinePaste?(
		node: CstNode,
		offset: number,
		text: string,
		preDelete: PasteRange | undefined,
		seam: PasteSeam
	): InlinePasteResult;
	/** Splice CST blocks at the target. Pure data transform. */
	onStructuralPaste?(
		node: CstNode,
		offset: number,
		blocks: CstNode[],
		preDelete: PasteRange | undefined,
		seam: PasteSeam
	): StructuralPasteResult;
	/**
	 * Structural paste whose splice scope is an ancestor (a tableCell splices at the
	 * table's parent). The hook owns the whole mutation; dispatch does nothing afterward.
	 */
	onScopedStructuralPaste?(input: ScopedStructuralPasteInput): Promise<void>;
}

// ── Registry ───────────────────────────────────────────────────────────────

const surfaces = createPluginRegistry<AnyBlockKind, PasteSurface>({
	label: 'registerPasteSurface',
	isBuiltin: isBuiltinBlockKind,
	ownerOf: pluginKindOwner
});

export function registerPasteSurface(surface: PasteSurface): void {
	surfaces.register(
		surface.kind,
		surface,
		`registerPasteSurface: "${surface.kind}" is already registered. Paste surfaces are register-once.`
	);
}

/** The kind's surface in an editor with this activation; a plugin's surface is absent where the
 *  editor left that plugin out, so the paste takes the default hooks. */
export function getPasteSurface(
	kind: AnyBlockKind,
	activation: PluginActivation
): PasteSurface | undefined {
	return surfaces.get(kind, activation);
}

/** Whether any plugin or built-in registered a surface for the kind, whatever the activation. */
export function isPasteSurfaceRegistered(kind: AnyBlockKind): boolean {
	return surfaces.has(kind);
}
