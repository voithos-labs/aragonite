import { describe, it, expect, beforeEach } from 'vitest';
import {
	registerPasteSurface,
	getPasteSurface,
	__resetPasteSurfacesForTests,
	type PasteSurface
} from '../../tree-operations/paste-surfaces';

function makeSurface(kind: PasteSurface['kind']): PasteSurface {
	return { kind };
}

describe('paste-surfaces registry', () => {
	beforeEach(() => {
		__resetPasteSurfacesForTests();
	});

	it('resolves a registered surface by kind', () => {
		const surface = makeSurface('paragraph');
		registerPasteSurface(surface);
		expect(getPasteSurface('paragraph')).toBe(surface);
	});

	it('returns undefined for an unregistered kind', () => {
		expect(getPasteSurface('paragraph')).toBeUndefined();
	});

	it('throws on re-register of the same kind (register-once)', () => {
		registerPasteSurface(makeSurface('paragraph'));
		expect(() => registerPasteSurface(makeSurface('paragraph'))).toThrow(/already registered/i);
	});

	it('keeps entries for different kinds independent', () => {
		registerPasteSurface(makeSurface('paragraph'));
		registerPasteSurface(makeSurface('heading'));
		expect(getPasteSurface('paragraph')).toBeDefined();
		expect(getPasteSurface('heading')).toBeDefined();
		expect(getPasteSurface('paragraph')).not.toBe(getPasteSurface('heading'));
	});
});
