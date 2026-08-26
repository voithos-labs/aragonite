// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseInline } from '$lib/core/inline';
import { CONTENT_VISIBILITY, renderedText } from '$lib/core/inline/visibility';
import type { PresentationMode } from '$lib/presentation-mode';
import { press } from './format-toggle-fixture';

// A selection taking another CONSTRUCT whole, so no span of the pressed mark starts at its own
// edge: the markers a wrap mints merge with a same-family run (`*ab*` in `**` re-reads as emphasis
// around strong), and a link's own delimiters sit at both edges of the text they enclose. Either
// way the press is about the content those delimiters hold. Miss-analysis: the read was only ever
// asked about selections whose flanks were content or its own delimiters, so every shape where a
// foreign construct's bytes sat at both edges answered false and the press disowned what it wrote.

const MODES: PresentationMode[] = ['source', 'live'];

const screenOf = (display: string) =>
	renderedText(parseInline(display, 0, display.length), display, CONTENT_VISIBILITY);

describe.each(MODES)('a selection taking another construct whole (%s)', (mode) => {
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

	// A construct carrying no mark of its own: the link's delimiters flank its text and the run
	// inside covers all of it, so the press sheds that run rather than adding a layer around one.
	it('sheds the mark held by a link the selection takes whole', () => {
		const display = '[**a**](u)';
		const { active, wrote, selected, activeAfter } = press({
			display,
			start: 0,
			end: display.length,
			format: 'strong',
			mode
		});
		expect(active).toBe(true);
		expect(wrote).toBe('[a](u)');
		expect(selected).toBe('a');
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
