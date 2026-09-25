import { describe, it, expect, beforeEach } from 'vitest';
import {
	registerPasteSurface,
	getPasteSurface,
	type PasteSurface
} from '../../tree-operations/paste-surfaces';
import { tableCellPasteSurface } from '../../components/blocks/table/table-cell-paste';
import { everyInstalledPlugin } from '../../schema/plugin-activation';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { ensurePasteSurface } from '$lib/test/support/paste-surface';
import type { AnyBlockKind } from '../../core/nodes';

// Plugin kinds, which the reset drops; a built-in kind's surface outlives it.
const NOTE = 'spec-note' as AnyBlockKind;
const ASIDE = 'spec-aside' as AnyBlockKind;

function makeSurface(kind: PasteSurface['kind']): PasteSurface {
	return { kind };
}

describe('paste-surfaces registry', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
	});

	it('resolves a registered surface by kind', () => {
		const surface = makeSurface(NOTE);
		registerPasteSurface(surface);
		expect(getPasteSurface(NOTE, everyInstalledPlugin)).toBe(surface);
	});

	it('returns undefined for an unregistered kind', () => {
		expect(getPasteSurface(NOTE, everyInstalledPlugin)).toBeUndefined();
	});

	it('throws on re-register of the same kind (register-once)', () => {
		registerPasteSurface(makeSurface(NOTE));
		expect(() => registerPasteSurface(makeSurface(NOTE))).toThrow(/already registered/i);
	});

	it('keeps entries for different kinds independent', () => {
		registerPasteSurface(makeSurface(NOTE));
		registerPasteSurface(makeSurface(ASIDE));
		expect(getPasteSurface(NOTE, everyInstalledPlugin)).toBeDefined();
		expect(getPasteSurface(ASIDE, everyInstalledPlugin)).toBeDefined();
		expect(getPasteSurface(NOTE, everyInstalledPlugin)).not.toBe(
			getPasteSurface(ASIDE, everyInstalledPlugin)
		);
	});

	it('keeps the built-in table-cell surface through the reset', () => {
		ensurePasteSurface(tableCellPasteSurface);
		__resetSchemaRegistriesForTests();
		expect(getPasteSurface('tableCell', everyInstalledPlugin)).toBe(tableCellPasteSurface);
	});
});
