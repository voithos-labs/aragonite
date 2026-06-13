import type { UndoEntryMode } from '../action-contracts';
import type { BlockKind, CstNode, Document } from '../core/nodes';
import type { PasteCommitCoordinator } from './paste/paste-deps';

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
	kind: BlockKind;
	/**
	 * Splice `text` into `node` at `offset` (optionally pre-deleting a range).
	 * Pure data transform.
	 */
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
	 * Structural paste whose splice scope is an ancestor (e.g. tableCell slices
	 * its table at the row and splices at the table's parent). The hook owns the
	 * whole mutation — dispatch routes here instead of `onStructuralPaste` and
	 * does nothing afterward.
	 */
	onScopedStructuralPaste?(input: ScopedStructuralPasteInput): Promise<void>;
}

// ── Registry ───────────────────────────────────────────────────────────────

const surfaces = new Map<BlockKind, PasteSurface>();

export function registerPasteSurface(surface: PasteSurface): void {
	if (import.meta.env.DEV && surfaces.has(surface.kind)) {
		console.warn(
			`[paste-surfaces] double register for ${surface.kind} — overwriting. ` +
				`Likely two modules registered the same kind, or a plugin forgot an idempotency guard.`
		);
	}
	surfaces.set(surface.kind, surface);
}

export function getPasteSurface(kind: BlockKind): PasteSurface | undefined {
	return surfaces.get(kind);
}

export function __resetPasteSurfacesForTests(): void {
	surfaces.clear();
}
