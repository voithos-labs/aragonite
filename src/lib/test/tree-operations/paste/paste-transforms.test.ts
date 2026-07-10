import { describe, it, expect, beforeEach } from 'vitest';
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

function appending(name: string, suffix: string): PasteTransform {
	return { name, transform: (text) => text + suffix };
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
		// 'seed!' — not 'null!' — proves the bang transform saw the untouched input.
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
