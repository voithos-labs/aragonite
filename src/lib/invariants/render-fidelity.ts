/**
 * G1.28 — rendered text fidelity. A renderer round-tripping bytes through an HTML parser
 * inherits engine-defined normalizations (U+0000, line endings, surrogates), and a gesture
 * that reads `textContent` back would commit the loss away. jsdom preserves all of them,
 * so this runtime belt is the only thing that can catch it — a unit suite cannot.
 */

import type { InvariantViolation } from '../assert';

/** First index at which the strings differ, or -1. */
function firstDivergence(rendered: string, expected: string): number {
	const shortest = Math.min(rendered.length, expected.length);
	for (let i = 0; i < shortest; i++) {
		if (rendered[i] !== expected[i]) return i;
	}
	return rendered.length === expected.length ? -1 : shortest;
}

export function checkRenderedTextFidelity(
	rendered: string,
	expected: string
): InvariantViolation | null {
	const at = firstDivergence(rendered, expected);
	if (at === -1) return null;
	const context = 12;
	const window = (text: string) => text.slice(Math.max(0, at - context), at + context);
	return {
		code: 'rendered-text-fidelity',
		message: `rendered text diverges from the block's raw at index ${at} — the HTML parser normalized a byte the CST still holds`,
		detail: {
			at,
			renderedLength: rendered.length,
			expectedLength: expected.length,
			rendered: window(rendered),
			expected: window(expected)
		}
	};
}
