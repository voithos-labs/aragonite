// The drawn caret's look from what the next typed letter would sit inside: one row per mark kind,
// and per combination the stylesheet composes, so a shape the CSS keys on is never left unset.
import { describe, expect, it } from 'vitest';
import { caretLook } from '#lib/caret/caret-look.js';
import type { InlineMarkKind } from '#lib/schema/inline-construct-policy.js';

const ROWS: [name: string, marks: InlineMarkKind[]][] = [
	['plain text', []],
	['bold', ['strong']],
	['italic', ['emphasis']],
	['strikethrough', ['strikethrough']],
	['inline code, which draws no shape of its own', ['inlineCode']],
	['bold italic', ['strong', 'emphasis']],
	['bold strikethrough', ['strong', 'strikethrough']],
	['italic strikethrough', ['emphasis', 'strikethrough']],
	['bold italic strikethrough', ['strong', 'emphasis', 'strikethrough']],
	['code inside bold', ['strong', 'inlineCode']]
];

describe('caretLook', () => {
	it.each(ROWS)('%s shows every mark the letter would carry, outermost first', (_name, marks) => {
		const holders = marks.map((kind, start) => ({ kind, start }));
		expect(caretLook({ marks, holders })).toEqual({ marks });
	});
});
