// Miss-analysis: no case paired one trigger from two plugins under a grammar listing only one.
import { beforeEach, describe, expect, it } from 'vitest';
import { resetPluginPlatformForTests } from '#lib/testing.js';
import { definePlugin, installPlugins } from '#lib/schema/plugin-install.js';
import {
	INLINE_PRIORITIES,
	pairsItself,
	registerInlineSyntax
} from '#lib/core/inline/scan/plugin-syntax.js';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';
import { grammarListing } from './grammar-listing';

/** A plugin pairing `%` at its own priority, so both registrations stand side by side. */
const pairingPercent = (name: string, priority: number) =>
	definePlugin({
		name,
		setup() {
			registerInlineSyntax('%', () => null, { autoPair: true, priority });
		}
	});

beforeEach(() => {
	installPlugins([
		pairingPercent('first', INLINE_PRIORITIES.plugin),
		pairingPercent('second', INLINE_PRIORITIES.plugin + 1)
	]);
});

describe('a trigger two plugins pair belongs to both', () => {
	const cases: [string[], boolean][] = [
		[['first'], true],
		[['second'], true],
		[['first', 'second'], true],
		[[], false]
	];
	for (const [listed, pairs] of cases) {
		it(`${pairs ? 'pairs' : 'does not pair'} under [${listed.join(', ')}]`, () => {
			expect(pairsItself('%', grammarListing(listed))).toBe(pairs);
		});
	}
});

describe('the platform reset', () => {
	it('drops every owner of the trigger', () => {
		resetPluginPlatformForTests();
		expect(pairsItself('%', defaultGrammarView)).toBe(false);
	});
});
