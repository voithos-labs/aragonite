/**
 * Shared predicates for the inline layer's transition guards (G1.25–G1.27):
 * the widget-pool pass bracket, the reveal kernel's source-length precondition,
 * and the IME composition window. The interaction trace records these same
 * transitions; these predicates make the illegal ones fire on the `invariant:`
 * channel at their own seam.
 */
import type { InvariantViolation } from './assert';

export type PoolBracketAction = 'acquire' | 'beginPass' | 'sweep';

/**
 * G1.25 — every pool mutation respects the beginPass/sweep bracket. Outside a
 * bracket, adoption flags and pass tallies are meaningless, and key-only lookup
 * cannot distinguish byte-identical duplicate widgets.
 */
export function checkPoolBracket(
	passOpen: boolean,
	action: PoolBracketAction
): InvariantViolation | null {
	if (action === 'beginPass') {
		return passOpen
			? {
					code: 'begin-unswept',
					message: 'beginPass while a bracket is already open — the previous pass was never swept'
				}
			: null;
	}
	if (passOpen) return null;
	return action === 'acquire'
		? {
				code: 'acquire-outside-bracket',
				message:
					'acquire outside a beginPass/sweep bracket — adoption is only meaningful inside a rebuild pass'
			}
		: {
				code: 'sweep-outside-bracket',
				message:
					'sweep without an open bracket — nothing was adopted, so it would destroy every live widget'
			};
}

/**
 * G1.26 (kernel leg) — a reveal's source bytes span exactly its
 * [sourceStart, sourceEnd) range; a mismatch shifts every raw offset outside
 * the source across the swap, desyncing the offset walk.
 */
export function checkRevealSourceLength(
	sourceLength: number,
	sourceStart: number,
	sourceEnd: number
): InvariantViolation | null {
	if (sourceLength === sourceEnd - sourceStart) return null;
	return {
		code: 'source-length-mismatch',
		message: 'reveal source length differs from its [sourceStart, sourceEnd) range',
		detail: { sourceLength, sourceStart, sourceEnd }
	};
}

/**
 * G1.27 — a compositionend lands only inside a composition the surface saw
 * start. Browsers pair the events per element, so an unpaired end means a
 * consumer wired `compositionend` without `compositionstart` — every
 * composition keystroke was committed to the CST mid-IME.
 */
export function checkCompositionEndPaired(composing: boolean): InvariantViolation | null {
	if (composing) return null;
	return {
		code: 'end-without-start',
		message: 'compositionend with no open composition — the surface never saw compositionstart'
	};
}
