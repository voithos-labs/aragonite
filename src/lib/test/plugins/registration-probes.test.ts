// The "have I already registered" checks must cover every register-once call a plugin makes,
// so an idempotent module (hot reload, a re-imported registrar) can ask instead of catching.
// Miss-analysis: each check was tested against its own registry, never against the full set.
import { describe, it, expect, beforeEach } from 'vitest';
import {
	declarePluginKind,
	declaredPluginKind,
	isBlockKindDeclared,
	isInlineKindDeclared,
	declarePluginInlineKind,
	registerPasteTransform,
	isPasteTransformRegistered
} from '$lib/plugin';
import { applyPasteTransforms, resetPluginPlatformForTests } from '$lib/testing';
import { configureEditorEnv } from '$lib/env';
import { takeDevWarns } from '../support/warn-gate';

const KIND = 'probe-declared-kind';

beforeEach(() => resetPluginPlatformForTests());

describe('isBlockKindDeclared', () => {
	it('answers before and after a declaration, and after a reset', () => {
		expect(isBlockKindDeclared(KIND)).toBe(false);
		declarePluginKind(KIND);
		expect(isBlockKindDeclared(KIND)).toBe(true);

		resetPluginPlatformForTests();
		expect(isBlockKindDeclared(KIND)).toBe(false);
	});

	// What it exists for: both declaration calls throw, so without this check an idempotent
	// module has no way to ask that does not throw.
	it('lets an idempotent registrar re-run without a collision throw', () => {
		const declareOnce = () =>
			isBlockKindDeclared(KIND) ? declaredPluginKind(KIND) : declarePluginKind(KIND);
		expect(declareOnce()).toBe(KIND);
		expect(declareOnce()).toBe(KIND);
		expect(() => declarePluginKind(KIND)).toThrow(/already declared/);
	});

	it('does not answer for a built-in kind, which is never a declared plugin kind', () => {
		expect(isBlockKindDeclared('paragraph')).toBe(false);
	});

	it('is the block mirror of isInlineKindDeclared', () => {
		declarePluginInlineKind('probe-declared-inline');
		expect(isInlineKindDeclared('probe-declared-inline')).toBe(true);
		expect(isBlockKindDeclared('probe-declared-inline')).toBe(false);
	});
});

// A dev server replaces a duplicate registration where production and test throw
// (`schema/register-once.ts`); the paste registry follows the same rule.
describe('registerPasteTransform under the dev duplicate valve', () => {
	const named = (result: string) => ({ name: 'valve-probe', transform: () => result });

	it('throws on a duplicate under test, as production does', () => {
		registerPasteTransform(named('first'));
		expect(() => registerPasteTransform(named('second'))).toThrow(/already registered/);
	});

	it('replaces instead of throwing on a dev server', () => {
		registerPasteTransform(named('first'));
		configureEditorEnv({ isDev: true, isTest: false });
		expect(() => registerPasteTransform(named('second'))).not.toThrow();
		expect(isPasteTransformRegistered('valve-probe')).toBe(true);
		expect(applyPasteTransforms('x')).toBe('second');
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['registry']);
	});
});
