import { isBuiltinBlockKind, type AnyBlockKind, type CstNode, type Document } from '../core/nodes';
import type { LineEnding } from '../core/lines';
import type { Reading } from '../schema/reading';
import type { ChildSlot } from './list/task-paragraph';
import type { PasteCommitCoordinator } from './paste/paste-deps';
import type { PluginActivation } from '../schema/plugin-activation';
import { createBlockKindRegistry } from '../schema/plugin-registry';

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
}

export interface PasteSurface {
	kind: AnyBlockKind;
	/** The kind's editable element holds text, never blocks (a table cell), so a blank block at the
	 *  clipboard's edge is packaging: it neither picks the route nor lands in a splice. */
	blankEdgesArePackaging?: boolean;
	/** Pure. The pre-delete is a join, cleaned per `reading` like any other; every line the hook
	 *  writes takes `lineEnding`, the document's. */
	onInlinePaste?(
		node: CstNode,
		offset: number,
		text: string,
		preDelete: PasteRange | undefined,
		reading: Reading,
		lineEnding: LineEnding
	): InlinePasteResult;
	/** Splice CST blocks at the target. Pure data transform. `slot` is where the target sits, so
	 *  the text the hook leaves there is read as a reload reads it. */
	onStructuralPaste?(
		node: CstNode,
		offset: number,
		blocks: CstNode[],
		preDelete: PasteRange | undefined,
		reading: Reading,
		lineEnding: LineEnding,
		slot: ChildSlot
	): StructuralPasteResult;
	/**
	 * Structural paste whose splice scope is an ancestor (a tableCell splices at the
	 * table's parent). The hook owns the whole mutation; dispatch does nothing afterward.
	 */
	onScopedStructuralPaste?(input: ScopedStructuralPasteInput): Promise<void>;
}

// ── Registry ───────────────────────────────────────────────────────────────

const surfaces = createBlockKindRegistry<PasteSurface>({
	label: 'registerPasteSurface',
	isBuiltin: isBuiltinBlockKind
});

export function registerPasteSurface(surface: PasteSurface): void {
	surfaces.register(
		surface.kind,
		surface,
		`registerPasteSurface: "${surface.kind}" is already registered. Paste surfaces are register-once.`
	);
}

/** The kind's surface in an editor with this activation; a plugin kind's surface is absent where
 *  the editor left out the kind's plugin, so the paste takes the default hooks. */
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
