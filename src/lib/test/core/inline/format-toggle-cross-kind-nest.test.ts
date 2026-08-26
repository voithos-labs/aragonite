// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseInline } from '$lib/core/inline';
import { CONTENT_VISIBILITY, renderedText } from '$lib/core/inline/visibility';
import type { PresentationMode } from '$lib/presentation-mode';
import { press } from './format-toggle-fixture';

// A selection taking another kind's run WHOLE: the markers it mints merge with that run's, and the
// parse hands the outer layer to whichever kind the merged bytes open first — `*ab*` wrapped in
// `**` re-reads as emphasis around strong, so the mark landed on every byte of content while no
// span of it starts at the selection's own edge. Miss-analysis: the read was only ever asked about
// selections whose flanks were content or its own delimiters, so the one shape where a foreign
// run's delimiters sit at both edges answered false and the press wrote bytes it then disowned.

const MODES: PresentationMode[] = ['source', 'live'];

const screenOf = (display: string) =>
	renderedText(parseInline(display, 0, display.length), display, CONTENT_VISIBILITY);

describe.each(MODES)('a selection taking another kind’s run whole (%s)', (mode) => {
	// The `_ab_` row is the contrast: the same shape spelled so the runs cannot merge, which the
	// seam always answered, against the `*ab*` row where they do.
	it.each([
		['merging delimiter runs', '*ab*', '***ab***'],
		['delimiter runs that cannot merge', '_ab_', '**_ab_**']
	])('%s: wraps it and reads the mark it wrote', (_name, display, wrapped) => {
		const { active, wrote, activeAfter } = press({
			display,
			start: 0,
			end: display.length,
			format: 'strong',
			mode
		});
		expect(active).toBe(false);
		expect(wrote).toBe(wrapped);
		expect(activeAfter).toBe(true);
		expect(screenOf(wrote!)).toBe(screenOf(display));
	});

	it('sheds the run it wrote, back to the bytes it started from', () => {
		const display = '***ab***';
		const { active, wrote, selected, activeAfter } = press({
			display,
			start: 0,
			end: display.length,
			format: 'strong',
			mode
		});
		expect(active).toBe(true);
		expect(wrote).toBe('*ab*');
		expect(selected).toBe('ab');
		expect(activeAfter).toBe(false);
		expect(screenOf(wrote!)).toBe(screenOf(display));
	});

	// The outer kind of the same bytes, which already answered: shedding it leaves the inner run,
	// so the two kinds of one stack come off independently.
	it('sheds the outer kind of the same stack without touching the inner one', () => {
		const { active, wrote, activeAfter } = press({
			display: '***ab***',
			start: 0,
			end: 8,
			format: 'emphasis',
			mode
		});
		expect(active).toBe(true);
		expect(wrote).toBe('**ab**');
		expect(activeAfter).toBe(false);
	});
});
