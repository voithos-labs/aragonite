// @vitest-environment jsdom
// A range delete across a title line truncates both endpoints in place with no join, so a
// delimiter run the cut leaves unpaired must still go through the live-mode cleanup, or it paints
// as literal `**`. The title line's own bytes stay byte for byte, outside the cleanup.
// Miss-analysis: GH #133; no case selected across a title line without a table in the range.
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import type { PresentationMode } from '../../presentation-mode';
import { cleanLiveJoinSeam } from '../../components/blocks/text/live-join-seam';
import {
	registerLiveJoinSeamCleaner,
	__resetLiveJoinSeamCleanerForTests
} from '../../schema/inline-construct-policy';
import { rangeDelete } from '../../selection/range-delete';
import { createSharingState } from '../../tree-operations/sharing';
import { registerCalloutForTests } from './chrome-plugins';
import type { SelectionPoint } from '../../selection/primitives';
import { fixtureReading } from '../harness/fixture-grammar';

beforeEach(() => {
	registerCalloutForTests();
	registerLiveJoinSeamCleaner(cleanLiveJoinSeam);
});
afterEach(() => __resetLiveJoinSeamCleanerForTests());

// Paths: [0]=Above, [1]=callout ([1,0]=title, [1,1]=body paragraph), [2]=Below.
const FIXTURE = 'Above\n\n:::callout Title\nSome **bold** text\n:::\n\nBelow\n';

function run(source: string, start: SelectionPoint, end: SelectionPoint, mode?: PresentationMode) {
	const doc = parse(source);
	const result = rangeDelete(doc, start, end, createSharingState(), fixtureReading({}, mode));
	return { source: serialize(result.newDoc), caret: result.collapsedCaret };
}

describe('a live chrome-crossing delete drops the runs its truncation stranded', () => {
	// From inside `bold` (after "bo", offset 9) out of the container: the closer went with the
	// cut, so the kept head's `**` paints literally without the cleanup.
	it('body→outside: the stranded opener leaves the head, and the caret follows', () => {
		const { source, caret } = run(
			FIXTURE,
			{ path: [1, 1], offset: 9 },
			{ path: [2], offset: 3 },
			'live'
		);

		expect(source).not.toContain('**');
		expect(source).toContain('Some bo\n');
		expect(caret).toEqual({ path: [1, 1], offset: 7 });
	});

	it('chrome→body: the stranded closer leaves the kept tail', () => {
		const { source } = run(
			FIXTURE,
			{ path: [1, 0], offset: 3 },
			{ path: [1, 1], offset: 9 },
			'live'
		);

		expect(source).not.toContain('**');
		expect(source).toContain('ld text\n');
	});

	// The title line's bytes are the container's own line, so their truncation stays byte for
	// byte even in live mode.
	it('a chrome endpoint keeps its truncation byte-literal in live', () => {
		const marked = 'Above\n\n:::callout **Ti**tle\nBody\n:::\n\nBelow\n';
		const { source } = run(marked, { path: [0], offset: 2 }, { path: [1, 0], offset: 4 }, 'live');

		expect(source).toContain(':::callout **tle');
	});

	it('source mode keeps the truncation byte-literal, delimiters included', () => {
		const { source, caret } = run(FIXTURE, { path: [1, 1], offset: 9 }, { path: [2], offset: 3 });

		expect(source).toContain('Some **bo\n');
		expect(caret).toEqual({ path: [1, 1], offset: 9 });
	});
});
