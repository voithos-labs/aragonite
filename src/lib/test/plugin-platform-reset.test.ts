// Miss-analysis: each file reset the plugin platform in hooks of its own, so a file without one
// leaked its registrations into its next test, and no test pinned the setup file doing it for all.

import { beforeAll, describe, it, expect } from 'vitest';
import { declarePluginKind, definePlugin, isBlockKindDeclared } from '$lib/plugin';
import { installPlugins, isPluginInstalled } from '$lib/schema/plugin-install';
import { tryGetBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';

const LOADED_KIND = 'reset-probe-loaded';
const BEFORE_ALL_KIND = 'reset-probe-before-all';
const TEST_KIND = 'reset-probe-test';

declarePluginKind(LOADED_KIND);

describe('the unit setup resets the plugin platform before every test', () => {
	beforeAll(() => {
		declarePluginKind(BEFORE_ALL_KIND);
	});

	it('drops what the file registered as it loaded and in beforeAll', () => {
		expect(isBlockKindDeclared(LOADED_KIND)).toBe(false);
		expect(isBlockKindDeclared(BEFORE_ALL_KIND)).toBe(false);
	});

	// The last two cases run in order: the first registers what the second must not see.
	it('lets a test register and install', () => {
		declarePluginKind(TEST_KIND);
		installPlugins([definePlugin({ name: 'reset-probe', setup() {} })]);
		expect(isBlockKindDeclared(TEST_KIND)).toBe(true);
		expect(isPluginInstalled('reset-probe')).toBe(true);
	});

	it('hands the next test none of it, and the built-ins intact', () => {
		expect(isBlockKindDeclared(TEST_KIND)).toBe(false);
		expect(isPluginInstalled('reset-probe')).toBe(false);
		expect(tryGetBlockKindDescriptor('paragraph')).toBeDefined();
	});
});
