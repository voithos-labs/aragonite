// Miss-analysis: every language test registered outside a plugin install, so none read activation.
import { describe, expect, it } from 'vitest';
import python from 'highlight.js/lib/languages/python';
import { definePlugin, installPlugins } from '$lib/schema/plugin-install';
import { activationFor, everyInstalledPlugin } from '$lib/schema/plugin-activation';
import {
	getLanguageAliases,
	getLanguageGrammar,
	isLanguageRegistered,
	listLanguages,
	registerLanguage
} from '$lib/components/blocks/code/code-languages';

const snake = definePlugin({
	name: 'snake',
	setup: () => registerLanguage('snakelang', python, ['snk'])
});

describe("a plugin's language resolves only in an editor that lists the plugin", () => {
	it('highlights, lists and aliases it where the plugin is listed', () => {
		installPlugins([snake]);
		const listed = activationFor(['snake']);
		expect(getLanguageGrammar('snk', listed)?.name).toBe('snakelang');
		expect(listLanguages(listed)).toContain('snakelang');
		expect(getLanguageAliases('snakelang', listed)).toEqual(['snk']);
	});

	it('resolves none of it where the plugin is left out', () => {
		installPlugins([snake]);
		const unlisted = activationFor([]);
		expect(getLanguageGrammar('snakelang', unlisted)).toBeNull();
		expect(getLanguageGrammar('snk', unlisted)).toBeNull();
		expect(listLanguages(unlisted)).not.toContain('snakelang');
	});

	it('resolves nowhere once the plugin setup threw, though the name stays taken', () => {
		const half = definePlugin({
			name: 'half',
			setup() {
				registerLanguage('halflang', python);
				throw new Error('setup failed halfway');
			}
		});
		expect(() => installPlugins([half])).toThrow(/setup failed halfway/);
		expect(getLanguageGrammar('halflang', everyInstalledPlugin)).toBeNull();
		expect(listLanguages(everyInstalledPlugin)).not.toContain('halflang');
		expect(isLanguageRegistered('halflang')).toBe(true);
	});
});
