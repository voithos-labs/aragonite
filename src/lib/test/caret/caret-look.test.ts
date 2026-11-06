// The drawn caret's look from what the next typed letter would sit inside: the marks it carries,
// outermost first, and whether it sits in a boxed construct.
import { describe, expect, it } from 'vitest';
import { caretLook } from '#lib/caret/caret-look.js';
import type { InlineMarkKind } from '#lib/schema/inline-construct-policy.js';

const ROWS: [name: string, marks: InlineMarkKind[]][] = [
	['inline code, which draws no shape of its own', ['inlineCode']],
	['bold italic strikethrough', ['strong', 'emphasis', 'strikethrough']],
	['code inside bold', ['strong', 'inlineCode']]
];

describe('caretLook', () => {
	it.each(ROWS)('%s shows every mark the letter would carry, outermost first', (_name, marks) => {
		expect(caretLook({ marks }).marks).toEqual(marks);
	});

	// The chip's border has two stops; the look says which side the next letter is on.
	it.each([
		['inside a code chip', ['inlineCode'], true],
		['inside a chip in bold', ['strong', 'inlineCode'], true],
		['in bold, outside any chip', ['strong'], false],
		['in plain text', [], false]
	] as const)('%s: boxed is %s', (_name, marks, boxed) => {
		expect(caretLook({ marks: [...marks] }).boxed).toBe(boxed);
	});
});
