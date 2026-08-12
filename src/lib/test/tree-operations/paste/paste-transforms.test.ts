import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	registerPasteTransform,
	applyPasteTransforms,
	__resetPasteTransformsForTests,
	type PasteTransform
} from '../../../tree-operations/paste/paste-transforms';
import {
	definePlugin,
	installPlugins,
	__resetInstalledPluginsForTests
} from '../../../schema/plugin-install';
import { allowDevWarns, takeDevWarns } from '../../support/warn-gate';

// The ordering fixtures append unconditionally, so the dev idempotence probe warns on them;
// only the containment cases below are about the diagnostic itself.
afterEach(() => allowDevWarns(['paste-transform']));

function appending(name: string, suffix: string): PasteTransform {
	return { name, transform: (text) => text + suffix };
}

/** Appends `!` until its `throwFromCall`-th invocation, which throws. */
function throwingOnCall(
	name: string,
	throwFromCall: number
): { transform: PasteTransform; callCount: () => number } {
	let calls = 0;
	const transform: PasteTransform = {
		name,
		transform: (text) => {
			if (++calls >= throwFromCall) throw new Error('plugin bug');
			return `${text}!`;
		}
	};
	return { transform, callCount: () => calls };
}

describe('paste-transforms registry', () => {
	beforeEach(() => {
		__resetPasteTransformsForTests();
		__resetInstalledPluginsForTests();
	});

	it('returns the input unchanged when no transform is registered', () => {
		expect(applyPasteTransforms('seed')).toBe('seed');
	});

	it('applies transforms in registration order, each seeing the prior output', () => {
		registerPasteTransform(appending('first', '-1'));
		registerPasteTransform(appending('second', '-2'));
		expect(applyPasteTransforms('seed')).toBe('seed-1-2');
	});

	it('skips a transform that returns null, leaving the running text for the next', () => {
		registerPasteTransform({ name: 'not-mine', transform: () => null });
		registerPasteTransform({ name: 'bang', transform: (text) => `${text}!` });
		// 'seed!' rather than 'null!' proves the bang transform saw the untouched input.
		expect(applyPasteTransforms('seed')).toBe('seed!');
	});

	it('returns the input unchanged when every transform declines', () => {
		registerPasteTransform({ name: 'decliner', transform: () => null });
		expect(applyPasteTransforms('seed')).toBe('seed');
	});

	it('throws on a duplicate name (register-once)', () => {
		registerPasteTransform(appending('dup', '-a'));
		expect(() => registerPasteTransform(appending('dup', '-b'))).toThrow(/already registered/i);
	});

	it('names the owning plugin in a duplicate-name error', () => {
		installPlugins([
			definePlugin({
				name: 'owner-plugin',
				setup: () => registerPasteTransform({ name: 'shared', transform: () => null })
			})
		]);
		expect(() => registerPasteTransform({ name: 'shared', transform: () => null })).toThrow(
			/owner-plugin/
		);
	});

	it('clears the registry for tests', () => {
		registerPasteTransform(appending('gone', '-x'));
		__resetPasteTransformsForTests();
		expect(applyPasteTransforms('seed')).toBe('seed');
	});
});

describe('paste-transforms containment', () => {
	beforeEach(() => {
		__resetPasteTransformsForTests();
		__resetInstalledPluginsForTests();
	});

	it('treats a throwing transform as a decline, leaving the text untouched', () => {
		registerPasteTransform(throwingOnCall('thrower', 1).transform);
		expect(applyPasteTransforms('seed')).toBe('seed');
		const fires = takeDevWarns();
		expect(fires).toHaveLength(1);
		expect(fires[0].message).toContain("transform 'thrower' threw in the paste pipeline");
	});

	it('runs a later transform on the untouched text after an earlier one throws', () => {
		registerPasteTransform(throwingOnCall('thrower', 1).transform);
		registerPasteTransform({ name: 'bang', transform: (text) => `${text}?` });
		// 'seed?' proves the pipeline survived the throw AND fed the bang transform the
		// pre-throw running text.
		expect(applyPasteTransforms('seed')).toBe('seed?');
	});

	it('keeps the paste when the dev idempotence probe throws on the re-run', () => {
		const probe = throwingOnCall('probe-thrower', 2);
		registerPasteTransform(probe.transform);
		expect(applyPasteTransforms('seed')).toBe('seed!');
		expect(probe.callCount()).toBe(2); // the probe really ran — the pin is not vacuous
	});

	it('reports a probe-time throw as a probe throw, never as a non-idempotent rewrite', () => {
		registerPasteTransform(throwingOnCall('probe-thrower', 2).transform);
		applyPasteTransforms('seed');
		// The message names the probe, not a decline: a "declining" message would send the
		// author debugging a working paste.
		const messages = takeDevWarns().map((w) => w.message);
		expect(messages).toContainEqual(
			expect.stringContaining("transform 'probe-thrower' threw in the dev idempotence probe")
		);
		expect(messages).not.toContainEqual(expect.stringContaining('not idempotent'));
	});

	// Keeps the negative assertion above honest: the non-idempotent message is live, so its
	// absence on the probe-throw path is a real distinction.
	it('still reports a genuinely non-idempotent rewrite under its own message', () => {
		registerPasteTransform(appending('grows', '!'));
		applyPasteTransforms('seed');
		expect(takeDevWarns().map((w) => w.message)).toContainEqual(
			expect.stringContaining("'grows' is not idempotent")
		);
	});
});
