import { describe, expect, it } from 'vitest';
import { hidesDelimitersAtCaret, type PresentationMode } from '$lib/presentation-mode';

// Keyed by the union, so a new mode fails `npm run check` here until someone decides whether a
// rewrite at its caret may drop delimiter bytes.
const HIDES_AT_CARET: Record<PresentationMode, boolean> = {
	source: false,
	'preview-block': false,
	'preview-inline': false,
	live: true,
	reading: true
};

describe('hidesDelimitersAtCaret', () => {
	for (const [mode, hides] of Object.entries(HIDES_AT_CARET)) {
		it(`${mode} ${hides ? 'hides' : 'draws'} the caret block's delimiters`, () => {
			expect(hidesDelimitersAtCaret(mode as PresentationMode)).toBe(hides);
		});
	}
});
