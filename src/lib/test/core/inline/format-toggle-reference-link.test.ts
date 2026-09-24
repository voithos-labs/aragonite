// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
	createInlineFormatActiveMemo,
	isInlineFormatActive,
	toggleInlineFormat,
	type InlineFormatEdit
} from '$lib/core/inline/format-toggle';
import {
	buildLinkReferenceMap,
	type LinkReferenceResolver
} from '$lib/core/inline/link-reference-resolver';
import { parse } from '$lib/core/parser';
import type { PresentationMode } from '$lib/presentation-mode';
import { defaultGrammarView } from '$lib/schema/block-openers';
import type { InlineResolverRef } from '$lib/schema/inline-construct-policy';
import { planCrossBlockFormat } from '$lib/selection/cross-block/format-range';

// The format toggle reads a block with the link definitions it was drawn with, so a selection
// cutting into a reference link is refused the way one cutting into an inline link is (GH #455).
// Miss-analysis: every toggle fixture used inline links, which read the same with or without the
// document's definitions, and the edit the toggle took had no field to carry them.

const DEFINITION = '[ref]: https://x.com\n';
const resolver: LinkReferenceResolver = buildLinkReferenceMap(parse(DEFINITION).children).resolve;

function editOf(display: string, start: number, end: number): InlineFormatEdit {
	return {
		display,
		content: { start: 0, end: display.length },
		selection: { start, end },
		linkRef: { current: resolver, grammar: defaultGrammarView }
	};
}

const LINK_FORMS = [
	{ form: 'reference link', link: '[text][ref]' },
	{ form: 'inline link', link: '[text](https://x.com)' }
];
const MODES: PresentationMode[] = ['source', 'live'];

describe.each(LINK_FORMS)('bold over the edge of a $form', ({ link }) => {
	const display = `see ${link} here`;
	const insideText = display.indexOf('xt');

	it.each(MODES)('from inside the link text to the line end writes nothing (%s)', (mode) => {
		expect(toggleInlineFormat(editOf(display, insideText, display.length), 'strong', mode)).toBe(
			null
		);
	});

	it.each(MODES)('from before the link into its text writes nothing (%s)', (mode) => {
		expect(toggleInlineFormat(editOf(display, 1, insideText), 'strong', mode)).toBe(null);
	});

	it.each(MODES)('over the whole link wraps it (%s)', (mode) => {
		const start = display.indexOf('[');
		const result = toggleInlineFormat(editOf(display, start, start + link.length), 'strong', mode);
		expect(result?.newDisplay).toBe(`see **${link}** here`);
	});
});

describe('the pressed state beside a reference link', () => {
	// The link's brackets bind before emphasis, so with the definition the `*` pair never forms.
	const display = '*[a*][ref]';

	it('reads the emphasis the drawn block does not have as off', () => {
		expect(isInlineFormatActive(editOf(display, 2, 3), 'emphasis')).toBe(false);
	});

	it('re-reads when the definitions change under the same ref', () => {
		const linkRef: InlineResolverRef = { grammar: defaultGrammarView };
		const edit = { ...editOf(display, 2, 3), linkRef };
		const formatActive = createInlineFormatActiveMemo();
		expect(formatActive(edit, 'emphasis')).toBe(true);
		linkRef.current = resolver;
		expect(formatActive({ ...edit }, 'emphasis')).toBe(false);
	});
});

describe('a cross-block bold starting inside a reference link', () => {
	it('leaves the link block unwritten and bolds the next block', () => {
		const doc = parse(`see [text][ref] here\n\nother\n\n${DEFINITION}`);
		const plan = planCrossBlockFormat(
			doc,
			{ path: [0], offset: 7 },
			{ path: [1], offset: 5 },
			'strong',
			'source',
			{ current: resolver, grammar: defaultGrammarView }
		);
		expect(plan?.writes.map((write) => [write.path, write.newDisplay])).toEqual([
			[[1], '**other**']
		]);
	});
});
