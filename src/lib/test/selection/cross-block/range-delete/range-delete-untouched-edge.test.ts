// @vitest-environment jsdom
// A range ending at a block's first byte, or starting past its last, cuts nothing of it: a block
// with text joins by its text, its marker going with the boundary, and a rule or fence stays whole.
// Miss-analysis: every range delete row cut into both edge blocks, so none asked what a join does
// with a block the range only touches, and a rule's bytes joined a paragraph as text.
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { expectParseConverged } from '../../../harness/parse-converged';
import { fixtureReading } from '../../../harness/fixture-grammar';
import { deleteRange } from '../../../harness/range-delete';

const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });

function del(source: string, start: SelectionPoint, end: SelectionPoint, mode: PresentationMode) {
	const doc = parse(source);
	const result = deleteRange(doc, start, end, {
		reading: fixtureReading({}, mode),
		gesture: 'Backspace'
	});
	return { doc, caret: result.caret(result.newDoc) };
}

const FENCE = '```js\nbody\n```';

const ROWS: Array<[string, string, SelectionPoint, SelectionPoint, string]> = [
	// The block the range touches stays whole.
	['a rule', 'alpha\n\n---\n\nomega\n', at([0], 2), at([1], 0), 'al\n\n---\n\nomega\n'],
	['a star rule', 'alpha\n\n***\n\nomega\n', at([0], 2), at([1], 0), 'al\n\n***\n\nomega\n'],
	[
		'a quoted rule',
		'alpha\n\n> ---\n\nomega\n',
		at([0], 2),
		at([1, 0], 0),
		'al\n\n> ---\n\nomega\n'
	],
	[
		'a code block',
		`alpha\n\n${FENCE}\n\nomega\n`,
		at([0], 2),
		at([1], 0),
		`al\n\n${FENCE}\n\nomega\n`
	],
	[
		'an html block',
		'alpha\n\n<div>\nx\n</div>\n\nomega\n',
		at([0], 2),
		at([1], 0),
		'al\n\n<div>\nx\n</div>\n\nomega\n'
	],
	[
		'a rule the range starts past',
		'alpha\n\n---\n\nomega\n',
		at([1], 3),
		at([2], 2),
		'alpha\n\n---\n\nega\n'
	],
	[
		'a code block the range starts past',
		`alpha\n\n${FENCE}\n\nomega\n`,
		at([1], FENCE.length),
		at([2], 2),
		`alpha\n\n${FENCE}\n\nega\n`
	],
	// A block with text joins by its text.
	['a heading', 'alpha\n\n# Head\n\nomega\n', at([0], 2), at([1], 0), 'alHead\n\nomega\n'],
	// Simulation seed 12's shape: a range that cuts into the marker takes the bytes it covers.
	[
		'a heading cut inside its marker',
		'alpha\n\n## Head\n\nomega\n',
		at([0], 2),
		at([1], 2),
		'al Head\n\nomega\n'
	],
	// Simulation seed 5: End on a heading, Shift+Down to the next heading's start, Delete.
	[
		'a heading after a heading, across nothing but the boundary',
		'# Sprint Sync\n\n## Attendees\n\n- Dana\n',
		at([0], '# Sprint Sync'.length),
		at([1], 0),
		'# Sprint SyncAttendees\n\n- Dana\n'
	],
	['a paragraph', 'alpha\n\nbeta\n\nomega\n', at([0], 2), at([1], 0), 'albeta\n\nomega\n'],
	[
		'a quoted paragraph',
		'alpha\n\n> quoted\n\nomega\n',
		at([0], 2),
		at([1, 0], 0),
		'alquoted\n\nomega\n'
	],
	['a list item', 'alpha\n\n- item\n\nomega\n', at([0], 2), at([1, 0, 0], 0), 'alitem\n\nomega\n'],
	['a paragraph the range starts past', 'alpha\n\nomega\n', at([0], 5), at([1], 2), 'alphaega\n'],
	['a heading the range starts past', '# Head\n\nomega\n', at([0], 6), at([1], 2), '# Headega\n']
];

describe.each(['source', 'live'] as const)('in %s mode, a range that touches a block', (mode) => {
	it.each(ROWS)('%s', (_label, source, start, end, expected) => {
		const { doc } = del(source, start, end, mode);
		expect(serialize(doc)).toBe(expected);
		expectParseConverged(doc);
	});
});

describe('the caret after a range that touches a block it keeps whole', () => {
	it('stays where the range started when the block after it stays', () => {
		const { caret } = del('alpha\n\n---\n\nomega\n', at([0], 2), at([1], 0), 'source');
		expect(caret).toEqual(at([0], 2));
	});
});
