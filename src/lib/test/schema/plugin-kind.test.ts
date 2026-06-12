import { describe, expect, it } from 'vitest';
import { declarePluginKind } from '../../schema/plugin-kind';
import { registerBlockKind, tryGetBlockKindDescriptor } from '../../schema/block-kind-descriptor';

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
			isContainer: false,
			supportsInline: false
		});
		expect(tryGetBlockKindDescriptor(kind)?.mergeRole).toBe('not-mergeable');
	});
});
