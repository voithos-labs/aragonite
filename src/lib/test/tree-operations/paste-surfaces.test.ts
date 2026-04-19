import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

	it('overwrites the existing entry on re-register', () => {
		const first = makeSurface('paragraph');
		const second = makeSurface('paragraph');
		registerPasteSurface(first);
		registerPasteSurface(second);
		expect(getPasteSurface('paragraph')).toBe(second);
	});

	it('keeps entries for different kinds independent', () => {
		registerPasteSurface(makeSurface('paragraph'));
		registerPasteSurface(makeSurface('heading'));
		expect(getPasteSurface('paragraph')).toBeDefined();
		expect(getPasteSurface('heading')).toBeDefined();
		expect(getPasteSurface('paragraph')).not.toBe(getPasteSurface('heading'));
	});

	describe('dev-mode double-register warning', () => {
		let warnSpy: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		});
		afterEach(() => {
			warnSpy.mockRestore();
		});

		it('warns when the same kind is registered twice in DEV', () => {
			if (!import.meta.env.DEV) return;
			registerPasteSurface(makeSurface('paragraph'));
			registerPasteSurface(makeSurface('paragraph'));
			expect(warnSpy).toHaveBeenCalledOnce();
			expect(warnSpy.mock.calls[0][0]).toContain('double register');
		});

		it('does not warn on a fresh registration', () => {
			registerPasteSurface(makeSurface('paragraph'));
			expect(warnSpy).not.toHaveBeenCalled();
		});
	});
});
