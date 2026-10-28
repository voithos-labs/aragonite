// @vitest-environment jsdom
// A range delete across a title line or a table truncates its text endpoints in place with no
// join, so a delimiter run the cut leaves unpaired must still go through the live-mode cleanup, or
// it paints as literal `**`; source mode, and a title line's own bytes, stay byte for byte.
// Miss-analysis: the live-join cases only crossed text-to-text merges, never these branches.
import { beforeEach, describe, it, expect } from 'vitest';
import { parse } from '../../../../core/parser';
import { serialize } from '../../../../core/serializer';
import type { PresentationMode } from '../../../../presentation-mode';
import { cellPoint, type SelectionPoint } from '../../../../selection/primitives';
import { registerCalloutForTests } from '../../chrome-plugins';
import { fixtureReading } from '../../../harness/fixture-grammar';
import { deleteRange } from '../../../harness/range-delete';

beforeEach(() => {
	registerCalloutForTests();
});

function run(source: string, start: SelectionPoint, end: SelectionPoint, mode?: PresentationMode) {
	const doc = parse(source);
	const result = deleteRange(doc, start, end, { reading: fixtureReading({}, mode) });
	return { source: serialize(result.newDoc), caret: result.caret(result.newDoc) };
}

interface Cut {
	source: string;
	start: SelectionPoint;
	end: SelectionPoint;
}

// Paths in the callout: [0]=Above, [1]=callout ([1,0]=title, [1,1]=body paragraph), [2]=Below.
const CALLOUT = 'Above\n\n:::callout Title\nSome **bold** text\n:::\n\nBelow\n';
const PROSE_THEN_TABLE = 'Some **bold** text\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n';
const TABLE_THEN_PROSE = '| A | B |\n| --- | --- |\n| 1 | 2 |\n\nSome **bold** text\n';

// Each head cut starts inside `bold`, after "bo" (offset 9), so the closer goes with the cut.
const CROSSINGS: { name: string; head: Cut; headPath: number[]; tail: Cut }[] = [
	{
		// Miss-analysis: GH #133; no case selected across a title line without a table in the range.
		name: 'a title line',
		head: { source: CALLOUT, start: { path: [1, 1], offset: 9 }, end: { path: [2], offset: 3 } },
		headPath: [1, 1],
		tail: { source: CALLOUT, start: { path: [1, 0], offset: 3 }, end: { path: [1, 1], offset: 9 } }
	},
	{
		name: 'a table',
		head: { source: PROSE_THEN_TABLE, start: { path: [0], offset: 9 }, end: cellPoint([1], 1) },
		headPath: [0],
		// Miss-analysis: the tail row started at cell 0, which deletes the whole table and so skips the
		// table route; its end cleanup had no row. Starting at cell 2 keeps the header row.
		tail: { source: TABLE_THEN_PROSE, start: cellPoint([0], 2), end: { path: [1], offset: 9 } }
	}
];

describe.each(CROSSINGS)('a delete across $name', ({ head, headPath, tail }) => {
	it('in live, closes the run on the kept head, the caret before the closer', () => {
		const { source, caret } = run(head.source, head.start, head.end, 'live');

		expect(source).toContain('Some **bo**\n');
		expect(caret).toEqual({ path: headPath, offset: 9 });
	});

	it('in live, reopens the run on the kept tail', () => {
		const { source } = run(tail.source, tail.start, tail.end, 'live');

		expect(source).toContain('\n**ld** text\n');
	});

	it('in source mode, keeps the truncation byte-literal, delimiters included', () => {
		const { source, caret } = run(head.source, head.start, head.end);

		expect(source).toContain('Some **bo\n');
		expect(caret).toEqual({ path: headPath, offset: 9 });
	});
});

// The opener line's bytes are the container's own line, so their truncation stays byte for byte
// even in live mode.
it('a title line endpoint keeps its truncation byte-literal in live', () => {
	const marked = 'Above\n\n:::callout **Ti**tle\nBody\n:::\n\nBelow\n';
	const { source } = run(marked, { path: [0], offset: 2 }, { path: [1, 0], offset: 15 }, 'live');

	expect(source).toContain('Ab\n\n**tle\n');
});
