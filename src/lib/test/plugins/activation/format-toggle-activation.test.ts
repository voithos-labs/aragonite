// @vitest-environment jsdom
// Miss-analysis: no toggle test ran over latex or emoji syntax in an editor drawing it as text.
import { describe, expect, it, beforeEach } from 'vitest';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { EMOJI_KIND, emojiPlugin } from '#lib/plugins/emoji/index.js';
import { MATH_INLINE, latexPlugin } from '#lib/plugins/latex/index.js';
import { parseInline } from '#lib/core/inline/index.js';
import { toggleInlineFormat } from '#lib/core/inline/format-toggle.js';
import type { InlineMarkKind } from '#lib/schema/inline-construct-policy.js';
import { grammarListing } from './grammar-listing';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';

beforeEach(() => {
	installPlugins([
		latexPlugin({ renderer: () => ({ dom: document.createElement('span') }) }),
		emojiPlugin()
	]);
});

/** The bytes a toggle writes in an editor that lists neither latex nor emoji. */
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

// Without the installs every editor draws `$x$` and `:smile:` as text, and the cases below pass.
describe('the installed plugins read their syntax', () => {
	it('parses `$x$` and `:smile:` as their constructs where every plugin is listed', () => {
		const kinds = parseInline('a $x$ :smile:', 0, 13).map((node) => node.kind);
		expect(kinds).toEqual(expect.arrayContaining([MATH_INLINE, EMOJI_KIND]));
	});
});

describe('bold and italic read the syntax the editor draws', () => {
	it('bolds a range ending inside `$x$`, which the editor draws as text', () => {
		expect(toggledWithoutEither('a $x$ b', { start: 0, end: 4 }, 'strong')).toBe('**a $x**$ b');
	});

	it('bolds a range ending inside `:smile:`, which the editor draws as text', () => {
		expect(toggledWithoutEither('a :smile: b', { start: 0, end: 5 }, 'strong')).toBe(
			'**a :sm**ile: b'
		);
	});

	it('takes the italic off the letter inside `:sm*i*le:`', () => {
		expect(toggledWithoutEither('a :sm*i*le: b', { start: 6, end: 7 }, 'emphasis')).toBe(
			'a :smile: b'
		);
	});

	it('bolds the whole of `$**x**$` as one run rather than nesting a second', () => {
		expect(toggledWithoutEither('$**x**$', { start: 0, end: 7 }, 'strong')).toBe('**$x$**');
	});
});
