/**
 * Registry for PasteSurface descriptors — the per-block-kind paste
 * strategy hook pair consumed by pasteDispatch.
 *
 * Mirrors the 0.5.1 state-registry pattern: Map keyed by BlockKind,
 * overwrite-on-register, dev-mode warning on double-register. Plugins
 * at 1.2 register their surfaces here; 0.6.3's table surface will too.
 */

import type { BlockKind, CstNode } from '../core/nodes';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PasteRange {
	start: number;
	end: number;
}

export interface InlinePasteResult {
	/** New raw for the target node (including trailing line ending). */
	newRaw: string;
	/** Caret offset within the new raw after paste. */
	caretOffset: number;
}

export interface StructuralPasteResult {
	/** Replacement block sequence. */
	replacement: CstNode[];
	/** Index into `replacement` whose last position should receive focus. */
	focusReplacementIndex: number;
	/** Offset within the focused replacement block. */
	focusOffset: number;
}

export interface PasteSurface {
	kind: BlockKind;
	/**
	 * Handle an inline paste: plain text spliced into the target at offset.
	 * `preDelete` removes a range from the node's raw before the splice —
	 * used when the target had a selection at paste time. Returns the new
	 * raw and the post-paste caret offset. Stateless: pure data transform.
	 */
	onInlinePaste?(
		node: CstNode,
		offset: number,
		text: string,
		preDelete?: PasteRange
	): InlinePasteResult;
	/**
	 * Handle a structural paste: N CST blocks spliced at the target.
	 * Returns the replacement sequence (what to splice in place of the
	 * target) and focus landing info. Stateless: pure data transform.
	 */
	onStructuralPaste?(
		node: CstNode,
		offset: number,
		blocks: CstNode[],
		preDelete?: PasteRange
	): StructuralPasteResult;
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

/** Test-only: clear the registry between tests. */
export function __resetPasteSurfacesForTests(): void {
	surfaces.clear();
}
