import type { UndoEntryMode } from '../action-contracts';
import type { AnyBlockKind, CstNode, Document } from '../core/nodes';
import type { PresentationMode } from '../presentation-mode';
import type { InlineResolverRef } from '../schema/inline-construct-policy';
import type { GrammarView } from '../schema/block-openers';
import type { PasteCommitCoordinator } from './paste/paste-deps';
import type { PluginActivation } from '../schema/plugin-activation';
import { currentInstallingPlugin } from '../schema/plugin-install';
import { registerOnce } from '../schema/register-once';

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
	linkRef: InlineResolverRef | undefined;
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
	/** The instance grammar the splice's `bodyWrite` escape reparses in. Nullable on purpose, so
	 *  a new scoped paste target cannot silently drop it; `undefined` means the global grammar. */
	grammar: GrammarView | undefined;
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
		preDelete?: PasteRange,
		seam?: PasteSeam
	): InlinePasteResult;
	/** Splice CST blocks at the target. Pure data transform. */
	onStructuralPaste?(
		node: CstNode,
		offset: number,
		blocks: CstNode[],
		preDelete?: PasteRange,
		seam?: PasteSeam
	): StructuralPasteResult;
	/**
	 * Structural paste whose splice scope is an ancestor (a tableCell splices at the
	 * table's parent). The hook owns the whole mutation; dispatch does nothing afterward.
	 */
	onScopedStructuralPaste?(input: ScopedStructuralPasteInput): Promise<void>;
}

// ── Registry ───────────────────────────────────────────────────────────────

interface RegisteredSurface {
	surface: PasteSurface;
	/** The plugin whose setup registered it; null for the built-ins. */
	owner: string | null;
}

const surfaces = new Map<AnyBlockKind, RegisteredSurface>();

export function registerPasteSurface(surface: PasteSurface): void {
	registerOnce(
		surfaces.has(surface.kind),
		() => surfaces.set(surface.kind, { surface, owner: currentInstallingPlugin() }),
		`registerPasteSurface: "${surface.kind}" is already registered. Paste surfaces are register-once.`
	);
}

/** The kind's surface in an editor with this activation; a plugin's surface is absent where the
 *  editor left that plugin out, so the paste takes the default hooks. */
export function getPasteSurface(
	kind: AnyBlockKind,
	activation: PluginActivation
): PasteSurface | undefined {
	const entry = surfaces.get(kind);
	if (!entry || (entry.owner !== null && !activation.isActive(entry.owner))) return undefined;
	return entry.surface;
}

/** Whether any plugin or built-in registered a surface for the kind, whatever the activation. */
export function isPasteSurfaceRegistered(kind: AnyBlockKind): boolean {
	return surfaces.has(kind);
}

export function __resetPasteSurfacesForTests(): void {
	surfaces.clear();
}

export function __removePasteSurfaceForTests(kind: AnyBlockKind): void {
	surfaces.delete(kind);
}
