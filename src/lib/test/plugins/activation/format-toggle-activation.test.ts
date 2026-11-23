// @vitest-environment jsdom
// Miss-analysis: no toggle test ran over latex or footnote syntax in an editor drawing it as text.
import { describe, expect, it, beforeEach } from 'vitest';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { FOOTNOTE_REF_KIND, footnotesPlugin } from '#packages/footnotes/src/index.js';
import { MATH_INLINE, registeredMath } from '#lib/test/harness/registered-math.js';
import { parseInline } from '#lib/core/inline/index.js';
import { toggleInlineFormat } from '#lib/core/inline/format-toggle.js';
import type { InlineMarkKind } from '#lib/schema/inline-construct-policy.js';
import { grammarListing } from './grammar-listing';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';

beforeEach(() => {
	installPlugins([registeredMath(), footnotesPlugin()]);
});

/** The bytes a toggle writes in an editor that lists neither latex nor footnotes. */
function toggledWithoutEither(
	display: string,
	selection: { start: number; end: number },
	format: InlineMarkKind
): string | null {
	const edit = { display, content: { start: 0, end: display.length }, selection };
	return (
		toggleInlineFormat(
			{ ...edit, reading: fixtureReading({ grammar: grammarListing([]) }) },
			format
		)?.newDisplay ?? null
	);
}

// Without the installs every editor draws `$x$` and `[^note]` as text, and the cases below pass.
describe('the installed plugins read their syntax', () => {
	it('parses `$x$` and `[^note]` as their constructs where every plugin is listed', () => {
		const kinds = parseInline('a $x$ [^note]', 0, 13).map((node) => node.kind);
		expect(kinds).toEqual(expect.arrayContaining([MATH_INLINE, FOOTNOTE_REF_KIND]));
	});
});

describe('bold and italic read the syntax the editor draws', () => {
	it('bolds a range ending inside `$x$`, which the editor draws as text', () => {
		expect(toggledWithoutEither('a $x$ b', { start: 0, end: 4 }, 'strong')).toBe('**a $x**$ b');
	});

	it('bolds a range ending inside `[^note]`, which the editor draws as text', () => {
		expect(toggledWithoutEither('a [^note] b', { start: 0, end: 6 }, 'strong')).toBe(
			'**a [^no**te] b'
		);
	});

	it('takes the italic off the letter inside `[^no*t*e]`', () => {
		expect(toggledWithoutEither('a [^no*t*e] b', { start: 7, end: 8 }, 'emphasis')).toBe(
			'a [^note] b'
		);
	});

	it('bolds the whole of `$**x**$` as one run rather than nesting a second', () => {
		expect(toggledWithoutEither('$**x**$', { start: 0, end: 7 }, 'strong')).toBe('**$x$**');
	});
});
