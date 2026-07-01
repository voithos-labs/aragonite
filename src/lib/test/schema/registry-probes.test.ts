import { describe, it, expect, beforeEach } from 'vitest';
import { declarePluginKind } from '../../schema/plugin-kind';
import { registerBlockKind, isBlockKindRegistered } from '../../schema/block-kind-descriptor';
import {
	defineBlockComponent,
	registerBlockComponent,
	isBlockComponentRegistered
} from '../../schema/block-component-registry';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';

const fakeComponent = (() => {}) as unknown as Parameters<typeof defineBlockComponent>[0];

describe('registration probes', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
	});

	it('reports a built-in kind as registered and an unknown name as not', () => {
		expect(isBlockKindRegistered('paragraph')).toBe(true);
		expect(isBlockKindRegistered('nope')).toBe(false);
		expect(isBlockComponentRegistered('nope')).toBe(false);
	});

	it('flips from false to true across a plugin kind registration', () => {
		expect(isBlockKindRegistered('probeKind')).toBe(false);
		registerBlockKind(declarePluginKind('probeKind'), {
			mergeRole: 'not-mergeable',
			editable: false,
			isContainer: false,
			supportsInline: false
		});
		expect(isBlockKindRegistered('probeKind')).toBe(true);
	});

	it('flips from false to true across a plugin component registration', () => {
		const kind = declarePluginKind('probeComponent');
		expect(isBlockComponentRegistered('probeComponent')).toBe(false);
		registerBlockComponent(kind, defineBlockComponent(fakeComponent));
		expect(isBlockComponentRegistered('probeComponent')).toBe(true);
	});
});
