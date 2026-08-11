// @vitest-environment jsdom
//
// The chrome wall's range delete truncates both endpoints in place — no join — so the runs a
// cut strands never crossed the live cleaner and painted as literal `**` on screen. Prose
// truncations are half a join and take the cleaner's unpaired-run half; the chrome child's own
// raw writes stay byte-literal, the wall excluded from the cleaner's view (GH #133).
// Miss-analysis: the table branch's fix pinned its own prose truncations, but no pin selected
// across the chrome wall without a table — the sibling branch that skips the seam identically.
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
import { __resetPasteSurfacesForTests } from '../../tree-operations/paste-surfaces';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { registerCalloutKind } from '../../../routes/test/plugins/callout/callout-kind';
import type { SelectionPoint } from '../../selection/primitives';

beforeEach(() => {
	// registerChromeLeaf (inside registerCalloutKind) registers a paste surface; the schema
	// reset alone leaves it orphaned, so a re-register would collide.
	__resetSchemaRegistriesForTests();
	__resetPasteSurfacesForTests();
	registerCalloutKind();
	registerLiveJoinSeamCleaner(cleanLiveJoinSeam);
});
afterEach(() => __resetLiveJoinSeamCleanerForTests());

// Paths: [0]=Above, [1]=callout ([1,0]=title, [1,1]=body paragraph), [2]=Below.
const FIXTURE = 'Above\n\n:::callout Title\nSome **bold** text\n:::\n\nBelow\n';

function run(source: string, start: SelectionPoint, end: SelectionPoint, mode?: PresentationMode) {
	const doc = parse(source);
	const result = rangeDelete(doc, start, end, createSharingState(), undefined, mode, undefined);
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

	// The wall: the chrome child's bytes are the container's own line, so its truncation stays
	// byte-literal even in live — the cleaner never sees across it.
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
