/**
 * Where a caret key moves the caret, decided by the editor so every engine lands alike. A move of
 * any unit ends where a delete of that unit would, read off the same context, so Shift plus the key
 * selects what the delete takes (`docs/design/editor.md` § Atomic inline widgets).
 */

import { deleteExtent, type DeleteContext } from './delete-extent';
import type { MotionKey } from '../schema/keybindings';

/** A raw `[start, end)` a caret can't stop inside: a widget, a replace decoration, a CRLF pair. */
export interface CaretUnit {
	start: number;
	end: number;
}

export interface CaretUnitSource {
	/** The span `offset` sits against or inside, on the side `direction` names. A plain arrow
	 *  crosses only the spans that read as one character; `extending`, every span. */
	beside(offset: number, direction: 'forward' | 'backward', extending: boolean): CaretUnit | null;
	/** Called once a press crossed a span: the widget edge a click held stops naming the caret. */
	crossed(): void;
}

/** What a caret key asks for; a `character` step moves only across a span the caret can't stop in. */
export type MotionIntent = Pick<MotionKey, 'unit' | 'direction'>;

/** What a block hands the motion rule. */
export interface MotionContext {
	caret: number;
	/** The spans a character step crosses. */
	units: CaretUnitSource;
	/** Shift is held, so a character step crosses every span, not only the one-character ones. */
	extending: boolean;
	/** The block's delete context at `caret`, which every other unit reads; null declines them. */
	block: DeleteContext | null;
}

/** Where the move lands, in raw offsets; null where the editor names no landing inside the block (a
 *  plain arrow with no span beside it, a word at the bound it faces, a line nothing lays out). */
export function motionTarget(intent: MotionIntent, context: MotionContext): number | null {
	const forward = intent.direction === 'forward';
	if (intent.unit === 'character') {
		const unit = context.units.beside(context.caret, intent.direction, context.extending);
		return unit && (forward ? unit.end : unit.start);
	}
	const block = context.block;
	if (!block) return null;
	if (intent.unit === 'word') {
		const span = deleteExtent({ unit: 'word', direction: intent.direction }, block);
		return span && (forward ? span.end : span.start);
	}
	if (intent.unit === 'block-edge') return forward ? block.bounds.end : block.bounds.start;
	const edge = block.lineEdge?.(forward ? 'end' : 'start') ?? null;
	return edge === null ? null : Math.min(block.bounds.end, Math.max(block.bounds.start, edge));
}
