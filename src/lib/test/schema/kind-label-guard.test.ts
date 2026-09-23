// A blank descriptor `label` would render as an empty `aria-label`, an unnamed textbox, so both
// ways a label reaches the registry refuse it and name the kind.
import { afterEach, describe, expect, it } from 'vitest';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { augmentBlockKind, registerBlockKind } from '$lib/schema/block-kind-descriptor';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';

const minimal = {
	gapEdges: 'none',
	mergeRole: 'not-mergeable',
	editable: true,
	supportsInline: false,
	closure: testClosure
} as const;

afterEach(() => __resetSchemaRegistriesForTests());

describe('a block kind label is never blank', () => {
	it('registerBlockKind throws on an empty or whitespace label, naming the kind', () => {
		const kind = declarePluginKind('blankLabelled');
		expect(() => registerBlockKind(kind, { ...minimal, label: '' })).toThrow(/"blankLabelled"/);
		expect(() => registerBlockKind(kind, { ...minimal, label: '  ' })).toThrow(/label/);
	});

	it('augmentBlockKind throws on a blank label too', () => {
		const kind = declarePluginKind('laterBlanked');
		registerBlockKind(kind, { ...minimal, label: 'Later' });
		expect(() => augmentBlockKind(kind, { label: '' })).toThrow(/"laterBlanked"/);
	});
});
