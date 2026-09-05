// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { PresentationMode } from '$lib/presentation-mode';
import type { InlineMarkKind } from '$lib/schema/inline-construct-policy';
import { press } from './format-toggle-fixture';

// A selection lying wholly inside a construct's delimiter run carries no content to unformat: it
// clamps to nothing against that run's content, and the split's emission is the bytes unchanged
// with the selection collapsed onto a caret — a no-op the user pays an undo entry and their
// selection for. Miss-analysis: no case ever selected delimiter bytes alone, so neither the empty
// clamp nor `coverageFlipped`'s excuse for the collapsed selection it emitted was ever asked.

const MODES: PresentationMode[] = ['source', 'live'];

const CASES: [
	label: string,
	display: string,
	start: number,
	end: number,
	format: InlineMarkKind
][] = [
	['one byte of a two-byte run', '**bold** tail', 1, 2, 'strong'],
	['a whole opening run', '**bold** tail', 0, 2, 'strong'],
	['the opener of a same-kind nested run', '~~a ~b~ c~~', 4, 5, 'strikethrough'],
	['a code span fence', '`code` span', 0, 1, 'inlineCode']
];

describe.each(MODES)('a selection of delimiter bytes alone (%s)', (mode) => {
	it.each(CASES)(
		'declines rather than writing a no-op: %s',
		(_label, display, start, end, format) => {
			const { active, wrote } = press({ display, start, end, format, mode });
			expect(active).toBe(true);
			expect(wrote).toBe(null);
		}
	);
});
