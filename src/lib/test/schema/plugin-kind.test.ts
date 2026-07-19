import { describe, expect, it } from 'vitest';
import { declarePluginKind, declaredPluginKind } from '../../schema/plugin-kind';
import { registerBlockKind, tryGetBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import { testClosure } from '$lib/test/support/closure';

describe('declarePluginKind', () => {
	it('returns the name, branded, for a valid plugin kind', () => {
		expect(declarePluginKind('callout')).toBe('callout');
		expect(declarePluginKind('call-out')).toBe('call-out');
	});

	it('rejects collisions with built-in kinds', () => {
		expect(() => declarePluginKind('paragraph')).toThrow(/built-in/);
		expect(() => declarePluginKind('tableRow')).toThrow(/built-in/);
	});

	it('rejects malformed names', () => {
		for (const bad of ['', 'Has Space', 'has space', '1leading', 'UpperFirst']) {
			expect(() => declarePluginKind(bad)).toThrow(/invalid/);
		}
	});

	it('a declared kind round-trips through the descriptor registry', () => {
		const kind = declarePluginKind('pluginKindRegistryProbe');
		registerBlockKind(kind, {
			mergeRole: 'not-mergeable',
			editable: false,
			supportsInline: false,
			closure: testClosure
		});
		expect(tryGetBlockKindDescriptor(kind)?.mergeRole).toBe('not-mergeable');
	});
});

describe('declaredPluginKind', () => {
	it('recovers the brand for an already-declared name', () => {
		const kind = declarePluginKind('accessorProbe');
		expect(declaredPluginKind('accessorProbe')).toBe(kind);
	});

	it('throws for an undeclared name, naming the kind', () => {
		expect(() => declaredPluginKind('neverDeclaredKind')).toThrow(/neverDeclaredKind/);
	});

	it('does not declare — an accessor call for an undeclared name is not idempotent', () => {
		expect(() => declaredPluginKind('notYetDeclared')).toThrow();
		// A later collision must still be loud: the failed lookup didn't register it.
		expect(declarePluginKind('notYetDeclared')).toBe('notYetDeclared');
		expect(() => declarePluginKind('notYetDeclared')).toThrow(/already declared/);
	});
});
