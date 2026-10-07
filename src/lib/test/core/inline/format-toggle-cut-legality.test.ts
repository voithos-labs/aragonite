// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { press } from './format-toggle-fixture';

// A wrap endpoint inside an atomic construct strands a delimiter that re-pairs, so it is refused.
// Miss-analysis: no wrap case put a selection endpoint inside an atomic construct.

const MODES: PresentationMode[] = ['source', 'live'];
const ESCAPED = 'a\\*escaped\\* b';
const CODE = 'a `code` b';
const ENTITY = 'a &amp; b';

describe.each(MODES)('a wrap whose endpoint cuts a construct declines (%s)', (mode) => {
	it.each([
		['an escape', ESCAPED, 2, 10],
		['a code span', CODE, 3, 10],
		['an entity', ENTITY, 3, 9]
	])('%s', (_name, display, start, end) => {
		expect(press({ display, start, end, format: 'strong', mode }).wrote).toBeNull();
	});

	// Non-vacuity: the same constructs wrap when both endpoints sit on a boundary, and the restored
	// selection is covered by the mark.
	it.each([
		['between two escapes', ESCAPED, 3, 10, 'a\\***escaped**\\* b'],
		['around a code span', CODE, 2, 8, 'a **`code`** b'],
		['around an entity', ENTITY, 2, 7, 'a **&amp;** b']
	])('%s', (_name, display, start, end, expected) => {
		const { wrote, activeAfter } = press({ display, start, end, format: 'strong', mode });
		expect(wrote).toBe(expected);
		expect(activeAfter).toBe(true);
	});
});

// `*em*` wrapped in `**` merges into one stack, but every content byte still carries the mark.
// Miss-analysis: every wrap case selected a bare word, so no marker ever re-paired.
describe.each(MODES)('a wrap whose markers merge with a neighbouring run (%s)', (mode) => {
	it('writes the merged stack and reads the mark it wrote', () => {
		const { wrote, activeAfter } = press({
			display: '*em* z',
			start: 0,
			end: 4,
			format: 'strong',
			mode
		});
		expect(wrote).toBe('***em*** z');
		expect(activeAfter).toBe(true);
	});

	// The selection a marker-hiding mode can actually make is the content, and that one wraps
	// without merging: its markers land inside the run rather than against it.
	it('wraps the content the hidden run holds', () => {
		const { wrote, selected, activeAfter } = press({
			display: '*em* z',
			start: 1,
			end: 3,
			format: 'strong',
			mode
		});
		expect(wrote).toBe('***em*** z');
		expect(selected).toBe(mode === 'live' ? 'em' : '**em**');
		expect(activeAfter).toBe(true);
	});
});

// Taking one of a run's delimiters merges into a stack that misses the selection; live declines.
// Miss-analysis: the G2.14 property excuses a decline, so only this case can see one.
describe('a wrap whose merged bytes leave the selection uncovered', () => {
	const HALF_RUN = { display: '*em* z', start: 0, end: 3, format: 'strong' } as const;

	it('writes the literal bytes where the delimiters paint', () => {
		const { wrote, activeAfter } = press({ ...HALF_RUN, mode: 'source' });
		expect(wrote).toBe('***em*** z');
		expect(activeAfter).toBe(false);
	});

	it('declines where they do not', () => {
		expect(press({ ...HALF_RUN, mode: 'live' }).wrote).toBeNull();
	});
});
