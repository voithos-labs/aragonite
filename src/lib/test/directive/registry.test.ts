import { afterEach, describe, expect, it } from 'vitest';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import {
	registerDirective,
	resolveDirective,
	isDirectiveRegistered,
	__resetDirectiveRegistryForTests,
	type DirectiveDefinition
} from '$lib/core/directive/registry';

const kind = declarePluginKind('directiveRegistryProbe');

afterEach(() => __resetDirectiveRegistryForTests());

describe('registerDirective', () => {
	it('resolves a registered definition and reports it registered', () => {
		const def: DirectiveDefinition = { kind };
		registerDirective('container', 'note', def);
		expect(resolveDirective('container', 'note')).toBe(def);
		expect(isDirectiveRegistered('container', 'note')).toBe(true);
	});

	it('leaves an unregistered (tier,name) unresolved', () => {
		expect(resolveDirective('container', 'note')).toBeUndefined();
		expect(isDirectiveRegistered('container', 'note')).toBe(false);
	});

	it('throws on a duplicate (tier,name)', () => {
		registerDirective('container', 'note', { kind });
		expect(() => registerDirective('container', 'note', { kind })).toThrow(/already registered/i);
	});

	it('scopes registration by tier — the same name coexists across tiers', () => {
		const container: DirectiveDefinition = { kind };
		const leaf: DirectiveDefinition = { kind };
		registerDirective('container', 'note', container);
		registerDirective('leaf', 'note', leaf);
		expect(resolveDirective('container', 'note')).toBe(container);
		expect(resolveDirective('leaf', 'note')).toBe(leaf);
	});
});

describe('__resetDirectiveRegistryForTests', () => {
	it('clears registrations so the same (tier,name) re-registers without throwing', () => {
		registerDirective('container', 'note', { kind });
		__resetDirectiveRegistryForTests();
		expect(isDirectiveRegistered('container', 'note')).toBe(false);
		expect(() => registerDirective('container', 'note', { kind })).not.toThrow();
	});
});
