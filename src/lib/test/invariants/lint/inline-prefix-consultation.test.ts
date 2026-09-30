/**
 * The scan loop consults prefix inline syntax handlers from one site, ahead of the switch over
 * built-in triggers, so no single trigger's case can carry its own copy. The switch's cases
 * are held to the trigger table by `test/core/inline/scan/builtin-trigger-dispatch.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readEditorFile } from './scan-source';

function indexSource(): string {
	return readEditorFile('core/inline/scan/index.ts').code;
}

function switchOffset(): number {
	const at = indexSource().indexOf('switch (raw[ctx.pos])');
	if (at < 0) throw new Error('inline-prefix-consultation: scanInline switch not found');
	return at;
}

/** Start offsets of a call marker (parenthesized, so imports don't match). */
function callOffsets(marker: string): number[] {
	const code = indexSource();
	const offsets: number[] = [];
	for (let at = code.indexOf(marker); at >= 0; at = code.indexOf(marker, at + 1)) offsets.push(at);
	return offsets;
}

describe('G4.18 pre-switch prefix consultation: one home, ahead of the switch', () => {
	const switchAt = switchOffset();
	const gate = callOffsets('hasPrefixRungs()');
	const consult = callOffsets('getPrefixRungs(');

	it('hoists the consultation gate exactly once, before the switch', () => {
		expect(gate).toHaveLength(1);
		expect(gate[0]).toBeLessThan(switchAt);
	});

	// A copy of the consultation inside one case would add a second `getPrefixRungs(` after the
	// switch offset.
	it('consults reserved prefix inline syntax handlers from exactly one site, before the switch', () => {
		expect(consult).toHaveLength(1);
		expect(consult[0]).toBeLessThan(switchAt);
	});
});
