import { afterEach, describe, expect, it } from 'vitest';
import {
	declarePluginInlineKind,
	declaredPluginInlineKind,
	__clearDeclaredPluginInlineKindsForTests
} from '../../schema/plugin-kind';

afterEach(() => __clearDeclaredPluginInlineKindsForTests());

describe('declarePluginInlineKind', () => {
	it('returns the name, branded, for a valid plugin inline kind', () => {
		expect(declarePluginInlineKind('math')).toBe('math');
		expect(declarePluginInlineKind('inline-math')).toBe('inline-math');
	});

	it('rejects collisions with built-in inline kinds', () => {
		expect(() => declarePluginInlineKind('emphasis')).toThrow(/built-in/);
		expect(() => declarePluginInlineKind('inlineCode')).toThrow(/built-in/);
	});

	it('rejects malformed names', () => {
		for (const bad of ['', 'Has Space', 'has space', '1leading', 'UpperFirst']) {
			expect(() => declarePluginInlineKind(bad)).toThrow(/invalid/);
		}
	});

	it('rejects a duplicate plugin inline kind', () => {
		declarePluginInlineKind('math');
		expect(() => declarePluginInlineKind('math')).toThrow(/already declared/);
	});
});

describe('declaredPluginInlineKind', () => {
	it('recovers the brand for an already-declared name', () => {
		const kind = declarePluginInlineKind('accessorProbe');
		expect(declaredPluginInlineKind('accessorProbe')).toBe(kind);
	});

	it('throws for an undeclared name, naming the kind', () => {
		expect(() => declaredPluginInlineKind('neverDeclaredInlineKind')).toThrow(
			/neverDeclaredInlineKind/
		);
	});

	it('does not declare — an accessor call for an undeclared name is not idempotent', () => {
		expect(() => declaredPluginInlineKind('notYetDeclared')).toThrow();
		// A later collision must still be loud: the failed lookup didn't register it.
		expect(declarePluginInlineKind('notYetDeclared')).toBe('notYetDeclared');
		expect(() => declarePluginInlineKind('notYetDeclared')).toThrow(/already declared/);
	});
});
