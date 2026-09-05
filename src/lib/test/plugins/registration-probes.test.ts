// F5: the register-once probe set must cover every register-once call a plugin makes, so an
// idempotent module (HMR, a re-imported registrar) asks instead of catching a throw.
//
// Miss-analysis: the probe set was tested one probe at a time against its own registry, and
// no test held the SET to the registries a plugin actually writes — so the missing block
// declare-probe was invisible while its inline mirror shipped.
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

	// The bind it closes: both declaration seams throw, so without the probe an idempotent
	// module has no non-throwing way to ask.
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

	// Parity with the inline side, which is what makes the block probe's absence a gap.
	it('is the block mirror of isInlineKindDeclared', () => {
		declarePluginInlineKind('probe-declared-inline');
		expect(isInlineKindDeclared('probe-declared-inline')).toBe(true);
		expect(isBlockKindDeclared('probe-declared-inline')).toBe(false);
	});
});

// The dev-server survival valve (`schema/register-once.ts`): production and test keep the
// duplicate throw, a dev server replaces. The paste registry rides the same valve as every
// other register-once seam — this pins that it does.
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
