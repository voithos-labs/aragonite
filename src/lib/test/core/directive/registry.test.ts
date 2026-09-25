import { afterEach, describe, expect, it } from 'vitest';
import type { CstNode } from '$lib/core/nodes';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import {
	registerDirective,
	resolveDirective,
	isDirectiveRegistered,
	type DirectiveDefinition
} from '$lib/core/directive/registry';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';

const kind = declarePluginKind('directiveRegistryProbe');
const factory: NonNullable<DirectiveDefinition['fromDirective']> = (parsed) =>
	({ kind, leadingTrivia: parsed.leadingTrivia, raw: parsed.raw }) as CstNode;

afterEach(() => __resetSchemaRegistriesForTests());

describe('registerDirective', () => {
	it('resolves a registered definition and reports it registered', () => {
		const def: DirectiveDefinition = { kind, fromDirective: factory };
		registerDirective('container', 'note', def);
		expect(resolveDirective('container', 'note', defaultGrammarView)).toBe(def);
		expect(isDirectiveRegistered('container', 'note')).toBe(true);
	});

	it('leaves an unregistered (level,name) unresolved', () => {
		expect(resolveDirective('container', 'note', defaultGrammarView)).toBeUndefined();
		expect(isDirectiveRegistered('container', 'note')).toBe(false);
	});

	it('throws on a duplicate (level,name)', () => {
		registerDirective('container', 'note', { kind, fromDirective: factory });
		expect(() => registerDirective('container', 'note', { kind, fromDirective: factory })).toThrow(
			/already registered/i
		);
	});

	it('scopes registration by level: the same name coexists across levels', () => {
		const container: DirectiveDefinition = { kind, fromDirective: factory };
		const leaf: DirectiveDefinition = { kind };
		registerDirective('container', 'note', container);
		registerDirective('leaf', 'note', leaf);
		expect(resolveDirective('container', 'note', defaultGrammarView)).toBe(container);
		expect(resolveDirective('leaf', 'note', defaultGrammarView)).toBe(leaf);
	});
});

describe('registerDirective per-level factory contract', () => {
	it('rejects a container without a fromDirective factory', () => {
		expect(() => registerDirective('container', 'x', { kind })).toThrow(
			/requires a fromDirective/i
		);
	});

	it('accepts a container with a fromDirective factory', () => {
		expect(() =>
			registerDirective('container', 'y', { kind, fromDirective: factory })
		).not.toThrow();
	});

	it('rejects a text directive that supplies a fromDirective', () => {
		expect(() => registerDirective('text', 'z', { kind, fromDirective: factory })).toThrow(
			/kind-only/i
		);
	});

	it('accepts a kind-only text directive', () => {
		expect(() => registerDirective('text', 'w', { kind })).not.toThrow();
	});

	it('accepts a leaf directive with or without a factory', () => {
		expect(() => registerDirective('leaf', 'a', { kind })).not.toThrow();
		expect(() => registerDirective('leaf', 'b', { kind, fromDirective: factory })).not.toThrow();
	});
});

describe('__resetSchemaRegistriesForTests', () => {
	it('clears registrations so the same (level,name) re-registers without throwing', () => {
		registerDirective('container', 'note', { kind, fromDirective: factory });
		__resetSchemaRegistriesForTests();
		expect(isDirectiveRegistered('container', 'note')).toBe(false);
		expect(() =>
			registerDirective('container', 'note', { kind, fromDirective: factory })
		).not.toThrow();
	});
});
