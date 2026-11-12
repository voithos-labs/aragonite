// @vitest-environment jsdom
// Backspace or a command key over a block removed whole right under a title row lands at the row's
// end, except in live mode where that end is a hidden `:::name`, read as a paste reads the row.
// Miss-analysis: the landing rows met titled rows and summaries only, never a `:::` row with no title.
import { describe, expect, it } from 'vitest';
import {
	removalOf,
	wholeBlocksRemovalOf,
	type Place,
	type RemovalGesture
} from '#lib/range-edit/edit-range.js';
import type { Mode } from '#lib/range-edit/host.js';
import { checkHost } from './test-host';

/** Each kind's row above a rule, then a paragraph: where Backspace's caret goes in each mode. */
const ROWS: [kind: string, source: string, live: Place, source: Place][] = [
	[
		'an untitled `:::` row',
		':::note\n---\n\npara\n:::\n',
		{ at: 8, holds: 'boundary', parent: [0] },
		{ at: 7, holds: 'text' }
	],
	[
		'an untitled `:::` row of a generic directive',
		':::spoiler\n---\n\npara\n:::\n',
		{ at: 11, holds: 'boundary', parent: [0] },
		{ at: 10, holds: 'text' }
	],
	[
		'an untitled `:::` row with a space after the name',
		':::note \n---\n\npara\n:::\n',
		{ at: 8, holds: 'text' },
		{ at: 8, holds: 'text' }
	],
	[
		'a titled `:::` row',
		':::note Title\n---\n\npara\n:::\n',
		{ at: 13, holds: 'text' },
		{ at: 13, holds: 'text' }
	],
	[
		'a summary with text',
		'<details open>\n<summary>Sum</summary>\n\n---\n\npara\n\n</details>\n',
		{ at: 27, holds: 'text' },
		{ at: 27, holds: 'text' }
	],
	[
		'an empty summary, which takes a letter',
		'<details open>\n<summary></summary>\n\n---\n\npara\n\n</details>\n',
		{ at: 24, holds: 'text' },
		{ at: 24, holds: 'text' }
	],
	[
		"a footnote's label line, no title row",
		'[^1]: Sum\n\n    ---\n\n    para\n',
		{ at: 9, holds: 'text' },
		{ at: 9, holds: 'text' }
	]
];

const ruleOf = (source: string) => {
	const from = source.indexOf('---');
	return { from, to: from + 3 };
};

describe("Backspace's caret beside a title row", () => {
	for (const [kind, source, live, inSource] of ROWS) {
		for (const [mode, expected] of [
			['live', live],
			['source', inSource]
		] as [Mode, Place][]) {
			for (const gesture of ['backspace', 'command'] as RemovalGesture[]) {
				it(`${kind}, ${gesture}, ${mode}`, () => {
					const answer = removalOf(source, ruleOf(source), gesture, mode, checkHost());
					expect(answer.caret).toEqual(expected);
				});
			}
			it(`${kind}, a block focused whole, ${mode}`, () => {
				const answer = wholeBlocksRemovalOf(source, ruleOf(source), 'backspace', mode, checkHost());
				expect(answer.caret).toEqual(expected);
			});
		}
	}
});
