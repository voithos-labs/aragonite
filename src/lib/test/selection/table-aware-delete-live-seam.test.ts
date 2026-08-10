// @vitest-environment jsdom
//
// A table-crossing delete truncates its prose endpoint in place — no join — so the runs the cut
// strands never crossed the live cleaner and painted as literal `**` on screen. The truncation
// is half a join and takes the cleaner's unpaired-run half; source mode stays byte-literal.
// Miss-analysis: the live-join pins all crossed prose→prose merges, where cleanJoinedRaw runs;
// no pin selected across the table wall, the one branch that skips the seam.
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import type { PresentationMode } from '../../presentation-mode';
import { cleanLiveJoinSeam } from '../../components/blocks/text/live-join-seam';
import {
	registerLiveJoinSeamCleaner,
	__resetLiveJoinSeamCleanerForTests
} from '../../schema/inline-construct-policy';
import { tableAwareRangeDelete } from '../../selection/range-delete-table';
import { createSharingState } from '../../tree-operations/sharing';
import type { CellSelectionPoint, SelectionPoint } from '../../selection/primitives';

beforeEach(() => registerLiveJoinSeamCleaner(cleanLiveJoinSeam));
afterEach(() => __resetLiveJoinSeamCleanerForTests());

const PROSE_THEN_TABLE = 'Some **bold** text\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n';
const TABLE_THEN_PROSE = '| A | B |\n| --- | --- |\n| 1 | 2 |\n\nSome **bold** text\n';

const cell = (path: number[], index: number): CellSelectionPoint => ({
	path,
	offset: index,
	cellCoordinate: true
});

function run(source: string, start: SelectionPoint, end: SelectionPoint, mode?: PresentationMode) {
	const doc = parse(source);
	const result = tableAwareRangeDelete(doc, start, end, createSharingState(), undefined, mode);
	return { source: serialize(result.newDoc), caret: result.collapsedCaret };
}

describe('a live table-crossing delete drops the runs its truncation stranded', () => {
	// From inside `bold` (after "bo", offset 9) into the header row: the closer went with the
	// cut, so the kept head's `**` paints literally without the cleanup.
	it('prose→table: the stranded opener leaves the head, and the caret follows', () => {
		const { source, caret } = run(PROSE_THEN_TABLE, { path: [0], offset: 9 }, cell([1], 1), 'live');

		expect(source).not.toContain('**');
		expect(source).toContain('Some bo\n');
		expect(caret).toEqual({ path: [0], offset: 7 });
	});

	it('table→prose: the stranded closer leaves the tail', () => {
		const { source } = run(TABLE_THEN_PROSE, cell([0], 0), { path: [1], offset: 9 }, 'live');

		expect(source).not.toContain('**');
		expect(source).toContain('ld text\n');
	});

	it('source mode keeps the truncation byte-literal, delimiters included', () => {
		const { source, caret } = run(PROSE_THEN_TABLE, { path: [0], offset: 9 }, cell([1], 1));

		expect(source).toContain('Some **bo\n');
		expect(caret).toEqual({ path: [0], offset: 9 });
	});
});
