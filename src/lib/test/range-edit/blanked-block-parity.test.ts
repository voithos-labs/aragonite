// @vitest-environment jsdom
// A paste that leaves a block blank gives up the blank line under it by one rule, whether it took
// the block held whole or wrote over its text: blank text over a heading held whole in source mode
// leaves what the same text over the heading's text leaves in live mode, where the heading gives way.
// Miss-analysis: each route had rows of its own shapes, and none held the two to one answer inside
// a container, where the two copies of the rule read the blank line differently.
import { expect, it } from 'vitest';
import { editRange } from '#lib/range-edit/edit-range.js';
import { rangeOf, unmark } from './named-rows';
import { checkHost } from './test-host';

/** A heading inside each container, `‸` where its text starts. */
const SHAPES: [name: string, marked: string][] = [
	['at the top level', '# ‸Plan\n\nnext\n'],
	['under a callout’s opener', '> [!NOTE]\n> # ‸Plan\n>\n> next\n'],
	['under an admonition’s opener', ':::note\n# ‸Plan\n\nnext\n:::\n'],
	['last in a quote, text outside it', '> # ‸Plan\n\nnext\n'],
	['last in a quote, under its text', '> a\n>\n> # ‸Plan\n\nnext\n'],
	['in a list item, its paragraph under', '- # ‸Plan\n\n  next\n'],
	['in a list item, an item under', '- # ‸Plan\n\n- next\n'],
	['in a quote, CRLF', '> # ‸Plan\r\n>\r\n> next\r\n']
];

const paste = (text: string) => ({ paste: text, plain: false, holds: 'text' as const });

for (const [name, marked] of SHAPES)
	for (const blank of [' ', '\t'])
		it(`${name}: ${JSON.stringify(blank)} over the heading held whole leaves what its text’s write does`, () => {
			const host = checkHost();
			const at = marked.indexOf('‸');
			const start = marked.lastIndexOf('#', at);
			const end =
				marked.indexOf('\r', at) >= 0 ? marked.indexOf('\r', at) : marked.indexOf('\n', at);
			const whole = `${marked.slice(0, start)}⟦${marked.slice(start, end)}⟧${marked.slice(end)}`;
			const text = `${marked.slice(0, at)}⟦${marked.slice(at + 1, end)}⟧${marked.slice(end)}`;
			const held = editRange(
				unmark(whole.replace('‸', '')),
				rangeOf(whole.replace('‸', '')),
				paste(blank),
				'source',
				host
			);
			const written = editRange(unmark(text), rangeOf(text), paste(blank), 'live', host);
			expect(held.source).toBe(written.source);
		});
