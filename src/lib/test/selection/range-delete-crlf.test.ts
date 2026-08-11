// A range delete that consumes both endpoints whole leaves nothing to reparse, so every branch
// falls back to a minted empty paragraph. That paragraph's raw IS a line ending, and in a CRLF
// document it must be CRLF (G4.20). One case per branch: generic, table, and reserved chrome.
import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { rangeDelete } from '../../selection/range-delete';
import { createSharingState } from '../../tree-operations/sharing';
import { __resetPasteSurfacesForTests } from '../../tree-operations/paste-surfaces';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { registerCalloutKind } from '../../../routes/test/plugins/callout/callout-kind';
import { expectParseConverged } from '../harness/parse-converged';
import type { SelectionPoint } from '../../selection/primitives';

function run(source: string, start: SelectionPoint, end: SelectionPoint): string {
	const doc = rangeDelete(
		parse(source),
		start,
		end,
		createSharingState(),
		undefined,
		undefined,
		undefined
	).newDoc;
	// The minted paragraph is a blank line, so its own separator settles with the rest of the run —
	// bytes alone would pass on a shape that reloads one empty paragraph wider (GH #96).
	expectParseConverged(doc);
	return serialize(doc);
}

describe('rangeDelete keeps CRLF when both endpoints are consumed whole', () => {
	// The survivor is the document's first line now, and a head run separates from nothing: a
	// second blank line left behind would reload as an empty paragraph of its own.
	it('generic prose branch', () => {
		expect(
			run('aaa\r\n\r\nbbb\r\n\r\nccc\r\n', { path: [0], offset: 0 }, { path: [1], offset: 3 })
		).toBe('\r\nccc\r\n');
	});

	it('generic prose branch, whole document', () => {
		expect(run('aaa\r\n\r\nbbb\r\n', { path: [0], offset: 0 }, { path: [1], offset: 3 })).toBe(
			'\r\n'
		);
	});

	it('generic branch rebuilding an emptied blockquote', () => {
		expect(run('> q\r\n\r\nafter\r\n', { path: [0, 0], offset: 0 }, { path: [1], offset: 5 })).toBe(
			'>\r\n'
		);
	});

	it('table branch (table endpoint into prose)', () => {
		expect(
			run(
				'| a | b |\r\n| --- | --- |\r\n| 1 | 2 |\r\n\r\nafter\r\n',
				{ path: [0], offset: 0, cellCoordinate: true },
				{ path: [1], offset: 5 }
			)
		).toBe('\r\n');
	});

	it('leaves an LF document on LF', () => {
		expect(run('aaa\n\nbbb\n', { path: [0], offset: 0 }, { path: [1], offset: 3 })).toBe('\n');
	});
});

// Paths: [0]=Above, [1]=note ([1,0]=title, [1,1]=Body1, [1,2]=Body2), [2]=Below. Both endpoints
// are prose and both surviving slices are empty, so both take the minted-paragraph fallback.
describe('chromeAwareRangeDelete keeps CRLF on both truncated endpoints', () => {
	beforeEach(() => {
		// registerChromeLeaf registers a paste surface; the schema reset alone leaves
		// it orphaned, so a re-register would collide.
		__resetSchemaRegistriesForTests();
		__resetPasteSurfacesForTests();
		registerCalloutKind();
	});

	it('start inside the callout body, end at the last prose block', () => {
		expect(
			run(
				'Above\r\n\r\n:::callout Title\r\nBody1\r\n\r\nBody2\r\n:::\r\n\r\nBelow\r\n',
				{ path: [1, 1], offset: 0 },
				{ path: [2], offset: 5 }
			)
		).toBe('Above\r\n\r\n:::callout Title\r\n\r\n:::\r\n\r\n\r\n');
	});
});
