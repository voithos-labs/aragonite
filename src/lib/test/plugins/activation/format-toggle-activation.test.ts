// @vitest-environment jsdom
//
// Miss-analysis: every format-toggle test ran with each installed plugin active, so no case
// toggled over latex or emoji syntax in an editor that draws it as text.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetPluginPlatformForTests } from '$lib/testing';
import { installPlugins } from '$lib/schema/plugin-install';
import { emojiPlugin } from '$lib/plugins/emoji';
import { latexPlugin } from '$lib/plugins/latex';
import { toggleInlineFormat } from '$lib/core/inline/format-toggle';
import type { InlineMarkKind } from '$lib/schema/inline-construct-policy';
import { grammarListing } from './grammar-listing';
import { fixtureReading } from '$lib/test/harness/fixture-grammar';

beforeAll(() => {
	resetPluginPlatformForTests();
	installPlugins([
		latexPlugin({ renderer: () => ({ dom: document.createElement('span') }) }),
		emojiPlugin()
	]);
});
afterAll(resetPluginPlatformForTests);

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
