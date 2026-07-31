import type { UndoEntryMode } from '../action-contracts';
import type { AnyBlockKind, CstNode, Document } from '../core/nodes';
import type { PasteCommitCoordinator } from './paste/paste-deps';
import { registerOnce } from '../schema/register-once';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PasteRange {
	start: number;
	end: number;
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
}

export interface PasteSurface {
	kind: AnyBlockKind;
	/** Splice `text` into `node` at `offset` (optionally pre-deleting a range). Pure. */
	onInlinePaste?(
		node: CstNode,
		offset: number,
		text: string,
		preDelete?: PasteRange
	): InlinePasteResult;
	/** Splice CST blocks at the target. Pure data transform. */
	onStructuralPaste?(
		node: CstNode,
		offset: number,
		blocks: CstNode[],
		preDelete?: PasteRange
	): StructuralPasteResult;
	/**
	 * Structural paste whose splice scope is an ancestor (a tableCell splices at the
	 * table's parent). The hook owns the whole mutation; dispatch does nothing afterward.
	 */
	onScopedStructuralPaste?(input: ScopedStructuralPasteInput): Promise<void>;
}

// ── Registry ───────────────────────────────────────────────────────────────

const surfaces = new Map<AnyBlockKind, PasteSurface>();

export function registerPasteSurface(surface: PasteSurface): void {
	registerOnce(
		surfaces.has(surface.kind),
		() => surfaces.set(surface.kind, surface),
		`registerPasteSurface: "${surface.kind}" is already registered. Paste surfaces are register-once.`
	);
}

export function getPasteSurface(kind: AnyBlockKind): PasteSurface | undefined {
	return surfaces.get(kind);
}

export function __resetPasteSurfacesForTests(): void {
	surfaces.clear();
}

export function __removePasteSurfaceForTests(kind: AnyBlockKind): void {
	surfaces.delete(kind);
}
