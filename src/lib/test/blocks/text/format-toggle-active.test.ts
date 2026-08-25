import { describe, it, expect } from 'vitest';
import { isInlineFormatActive } from '$lib/components/blocks/text/format-toggle';
import type { InlineMarkKind } from '$lib/cursor/pending-marks';
import { whole } from './format-toggle-fixture';

// The pressed-state read answers "would a press unapply": the same arms the toggle routes by,
// asked without emitting. Held beside the toggle so the pressed paint and the press cannot drift.

const activeAt = (raw: string, start: number, end: number, format: InlineMarkKind) =>
	isInlineFormatActive({ display: raw, content: whole(raw), selection: { start, end } }, format);

describe('isInlineFormatActive', () => {
	it('reads a caret inside the construct as active, and in plain text as not', () => {
		expect(activeAt('**word**', 4, 4, 'strong')).toBe(true);
		expect(activeAt('plain **word**', 2, 2, 'strong')).toBe(false);
	});

	it('reads every unapply alignment as active', () => {
		// Covered sub-range, whole content, and the selection carrying its own markers.
		expect(activeAt('**text text2**', 7, 12, 'strong')).toBe(true);
		expect(activeAt('**text text2**', 2, 12, 'strong')).toBe(true);
		expect(activeAt('x **word** y', 2, 10, 'strong')).toBe(true);
	});

	it('reads the apply directions as inactive', () => {
		expect(activeAt('hello world', 0, 5, 'strong')).toBe(false);
		// A half-in selection applies over the union, so it is not yet active.
		expect(activeAt('**text text2** plain', 7, 18, 'strong')).toBe(false);
	});

	it('keys on the kind, not the delimiter bytes', () => {
		expect(activeAt('**word**', 2, 6, 'emphasis')).toBe(false);
		expect(activeAt('__word__', 2, 6, 'strong')).toBe(true);
		expect(activeAt('`code run`', 3, 3, 'inlineCode')).toBe(true);
	});
});
