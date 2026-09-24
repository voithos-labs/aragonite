// @vitest-environment jsdom
//
// Miss-analysis: the auto-pair and on-type completer suites ran with every installed plugin
// active, so removing either owner check left every test green.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetPluginPlatformForTests } from '$lib/testing';
import { definePlugin, installPlugins } from '$lib/schema/plugin-install';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { registerInlineSyntax } from '$lib/core/inline/scan/plugin-syntax';
import { completeLineOnType, registerBlockCompleter } from '$lib/schema/block-completions';
import { resolveDelimiterAutoPair } from '$lib/components/blocks/text/delimiter-autopair';
import { defaultGrammarView, type GrammarView } from '$lib/schema/block-openers';
import { grammarListing } from './grammar-listing';

const unlisted = definePlugin({
	name: 'unlisted',
	setup() {
		registerInlineSyntax('%', () => null, { autoPair: true });
		registerBlockCompleter(declarePluginKind('rule-box'), {
			onType: true,
			tryComplete: (line) =>
				line === '%%%' ? { lines: ['%%%', 'x'], caret: { path: [], line: 1, column: 0 } } : null
		});
	}
});
const listed = definePlugin({ name: 'listed', setup() {} });

beforeEach(() => {
	resetPluginPlatformForTests();
	installPlugins([listed, unlisted]);
});
afterEach(resetPluginPlatformForTests);

const typedPercent = (grammar: GrammarView) =>
	resolveDelimiterAutoPair('a ', { start: 0, end: 2 }, 2, '%', () => true, { grammar });

describe("an unlisted plugin's delimiter does not auto-pair", () => {
	it('types a lone `%` where the plugin is left out', () => {
		expect(typedPercent(grammarListing(['listed']))).toBeNull();
	});

	it('pairs it where every installed plugin is active', () => {
		expect(typedPercent(defaultGrammarView)).toMatchObject({ kind: 'write', text: 'a %%' });
	});
});

describe("an unlisted plugin's on-type completer never fires", () => {
	it('declines where the plugin is left out', () => {
		expect(completeLineOnType('%%%', grammarListing(['listed']))).toBeNull();
	});

	it('completes where every installed plugin is active', () => {
		expect(completeLineOnType('%%%', defaultGrammarView)).not.toBeNull();
	});
});
