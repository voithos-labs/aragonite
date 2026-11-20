/**
 * G1.212: a range read as bytes spans every block its coverage holds whole, so a copy or a removal
 * never takes part of one (a closed details' hidden body, a directive's closing line).
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';

interface Span {
	from: number;
	to: number;
}

export function checkRangeHoldsWhole(
	range: Span,
	whole: readonly Span[]
): InvariantViolation | null {
	const cut = whole.find((block) => block.from < range.from || block.to > range.to);
	return cut
		? {
				code: 'range-holds-whole',
				message: `the range [${range.from}, ${range.to}) cuts [${cut.from}, ${cut.to}), a block it holds whole`
			}
		: null;
}
