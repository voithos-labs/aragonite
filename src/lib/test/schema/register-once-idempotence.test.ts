import { afterEach, describe, expect, it } from 'vitest';
import { configureEditorEnv, resetEditorEnv } from '$lib/env';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { registerBlockKind, getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import {
	registerBlockComponent,
	getBlockComponent,
	type BlockComponentEntry
} from '$lib/schema/block-component-registry';
import {
	registerBlockOpener,
	getOrderedOpeners,
	type BlockOpener
} from '$lib/schema/block-openers';
import { registerBlockCommand, getBlockCommand } from '$lib/schema/block-commands';
import type { AnyCommandId } from '$lib/schema/command-id';
import {
	registerInlineSyntax,
	getInlineRungs,
	__resetInlineSyntaxForTests,
	type InlineSyntaxRecognizer
} from '$lib/core/inline/scan/plugin-syntax';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';

const registration = (editable: boolean) =>
	({ mergeRole: 'not-mergeable', editable, supportsInline: false, closure: testClosure }) as const;

const stubComponent = (tag: string) => ({ tag }) as unknown as BlockComponentEntry;
const stubOpener = (priority: number): BlockOpener => ({
	priority,
	tryOpen: () => null,
	interruptsParagraph: false
});
const recognizer = (): InlineSyntaxRecognizer => () => null;

afterEach(() => {
	resetEditorEnv();
	__resetSchemaRegistriesForTests();
	__resetInlineSyntaxForTests();
});

// The softened seams must still throw under test. registry-conflict.test.ts pins the
// block trio; this widens the guarantee to inline syntax + declare.
describe('register-once still throws on duplicate under test', () => {
	it('registerInlineSyntax throws on a duplicate trigger', () => {
		registerInlineSyntax('¬', recognizer());
		expect(() => registerInlineSyntax('¬', recognizer())).toThrow(/already registered/i);
	});

	it('declarePluginKind throws on a duplicate name', () => {
		declarePluginKind('dup-under-test');
		expect(() => declarePluginKind('dup-under-test')).toThrow(/already declared/i);
	});
});

// The mint validates the name inside apply, before the map write, so a rejected name
// cannot leave an orphaned handler behind a thrown registration.
describe('registerBlockCommand validates the name before touching the registry', () => {
	it('an invalid name throws and leaves no orphaned handler', () => {
		expect(() => registerBlockCommand('paragraph', 'Invalid Name', () => false)).toThrow();
		expect(getBlockCommand('paragraph', 'Invalid Name' as AnyCommandId)).toBeUndefined();
	});
});

// The dev-server survival valve: a re-evaluated registrar (HMR/SSR) re-runs its registerX
// calls against a surviving registry Map, and a throw there 500s the route.
describe('dev re-registration replaces instead of throwing', () => {
	function asDevNotTest() {
		configureEditorEnv({ isDev: true, isTest: false });
	}

	it('registerBlockKind replaces the descriptor', () => {
		const kind = declarePluginKind('dev-kind');
		registerBlockKind(kind, registration(true));
		asDevNotTest();
		expect(() => registerBlockKind(kind, registration(false))).not.toThrow();
		expect(getBlockKindDescriptor(kind).editable).toBe(false);
	});

	it('registerBlockComponent replaces the entry', () => {
		const kind = declarePluginKind('dev-component');
		const first = stubComponent('first');
		const second = stubComponent('second');
		registerBlockComponent(kind, first);
		asDevNotTest();
		expect(() => registerBlockComponent(kind, second)).not.toThrow();
		expect(getBlockComponent(kind)).toBe(second);
	});

	it('registerBlockOpener replaces the opener and re-clears the ordered cache', () => {
		const kind = declarePluginKind('dev-opener');
		registerBlockKind(kind, registration(true));
		registerBlockOpener(kind, stubOpener(15));
		// Prime the cache so the replace has to invalidate it, not just an empty read.
		expect(getOrderedOpeners().some((o) => o.priority === 15)).toBe(true);
		asDevNotTest();
		expect(() => registerBlockOpener(kind, stubOpener(16))).not.toThrow();
		expect(getOrderedOpeners().some((o) => o.priority === 16)).toBe(true);
		expect(getOrderedOpeners().some((o) => o.priority === 15)).toBe(false);
	});

	it('registerInlineSyntax replaces the recognizer', () => {
		const first = recognizer();
		const second = recognizer();
		registerInlineSyntax('¬', first);
		asDevNotTest();
		expect(() => registerInlineSyntax('¬', second)).not.toThrow();
		expect(getInlineRungs('¬')[0].recognizer).toBe(second);
	});

	it('declarePluginKind returns the existing brand on re-declaration', () => {
		const first = declarePluginKind('dev-declare');
		asDevNotTest();
		let second: string | undefined;
		expect(() => (second = declarePluginKind('dev-declare'))).not.toThrow();
		expect(second).toBe(first);
	});
});
