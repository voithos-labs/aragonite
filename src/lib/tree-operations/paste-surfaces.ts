/**
 * What a block kind answers of a paste before the range-edit core does: a table cell fills cells
 * from a grid, slices its table for blocks, and trims the text it leaves to the core.
 */

import { isBuiltinBlockKind, type AnyBlockKind, type Document } from '../core/nodes';
import type { PasteCommitCoordinator } from './paste/paste-deps';
import type { PluginActivation } from '../schema/plugin-activation';
import type { Reading } from '../schema/reading';
import { createBlockKindRegistry } from '../schema/plugin-kind';

// ── Types ──────────────────────────────────────────────────────────────────

/** A paste a kind answers itself: the text block at `targetPath`, the clipboard, and the cells of
 *  the block's table the editor holds selected. */
export interface ClipPasteInput {
	doc: Document;
	targetPath: number[];
	clip: { text: string; plain: boolean; own?: string };
	cells: { top: number; left: number; rows: number; cols: number } | null;
	controller: PasteCommitCoordinator;
	reading: Reading;
	activePlugins: PluginActivation;
}

export interface PasteSurface {
	kind: AnyBlockKind;
	/** A paste the kind answers ahead of the range-edit core, with the clipboard in hand (a table
	 *  cell fills cells from a grid and slices its table for blocks). False leaves it to the core. */
	onClipPaste?(input: ClipPasteInput): Promise<boolean>;
	/** The text the core writes for a paste the kind left to it (a cell trims the blank edges). */
	pastedText?(text: string): string;
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
 *  the editor left out the kind's plugin, so the core answers the paste alone. */
export function getPasteSurface(
	kind: AnyBlockKind,
	activation: PluginActivation
): PasteSurface | undefined {
	return surfaces.get(kind, activation);
}
