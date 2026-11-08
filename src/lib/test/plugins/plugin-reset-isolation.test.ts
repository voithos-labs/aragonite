// @vitest-environment jsdom
// A plugin author's suite, written against the published testing API: reset in `beforeEach`,
// re-install in each case, and every case sees exactly one install's registrations.
// Miss-analysis: the reset's test read a hand-kept list of registries, never the highlighter.
import { describe, it, expect, beforeEach } from 'vitest';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import { resetPluginPlatformForTests } from '#lib/testing.js';
import {
	definePlugin,
	highlightCode,
	registerBlockCompleter,
	registerInlineWidgetKind,
	registerLanguage
} from '#lib/plugin.js';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { everyInstalledPlugin } from '#lib/schema/plugin-activation.js';
import {
	getLanguageGrammar,
	registerBuiltinLanguage
} from '#lib/components/blocks/code/code-languages.js';
import { completeTypedLine } from '#lib/schema/block-completions.js';
import { isInlineWidgetKind } from '#lib/core/inline/inline-widgets.js';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';
import type { LanguageFn } from 'highlight.js';

/** The highlighted spans, as `class:text`. */
const tokens = (body: string) =>
	[...highlightCode(body, 'probelang').childNodes]
		.filter((n) => n.nodeType === 1)
		.map((n) => `${(n as HTMLElement).className}:${n.textContent}`);
const BODY = 'def f(): pass\nconst x = 1';

function installLanguagePlugin(grammar: LanguageFn): void {
	installPlugins([
		definePlugin({ name: 'rows', setup: () => registerLanguage('probelang', grammar) })
	]);
}

describe('resetPluginPlatformForTests between cases', () => {
	beforeEach(() => resetPluginPlatformForTests());

	it('case 1 highlights with its own grammar', () => {
		installLanguagePlugin(javascript);
		expect(tokens(BODY)).toContain('code-tok-keyword:const');
	});

	it("case 2 highlights with its own grammar, not an earlier case's", () => {
		installLanguagePlugin(python);
		expect(tokens(BODY)).toContain('code-tok-keyword:def');
		expect(tokens(BODY)).not.toContain('code-tok-keyword:const');
	});
});

// Miss-analysis: every built-in registered at startup, never from inside a plugin install.
describe('a built-in registered from inside a plugin install', () => {
	it('stays a built-in: the reset keeps it', () => {
		installPlugins([
			definePlugin({
				name: 'lazy',
				setup: () => registerBuiltinLanguage('lazylang', python)
			})
		]);
		resetPluginPlatformForTests();
		expect(getLanguageGrammar('lazylang', everyInstalledPlugin)).not.toBeNull();
	});
});

// Miss-analysis: the reset tests registered plugin entries only for plugin kinds, so a reset that
// asked whose activation an entry answers to, not who registered it, kept a built-in kind's entry.
describe('a plugin’s entry for a built-in kind', () => {
	const routes = [
		{
			name: 'a block completer for paragraph',
			register: () =>
				registerBlockCompleter('paragraph', {
					tryComplete: (line) =>
						line === '¤' ? { lines: ['¤', '¤'], caret: { path: [], line: 1, column: 1 } } : null
				}),
			isRegistered: () => completeTypedLine('¤', defaultGrammarView) !== null
		},
		{
			name: 'an inline widget for emphasis',
			register: () =>
				registerInlineWidgetKind('emphasis', {
					isWidget: () => true,
					view: () => ({})
				}),
			isRegistered: () => isInlineWidgetKind('emphasis', defaultGrammarView)
		}
	];

	it.each(routes)(
		'$name is dropped by the reset, so the next case can install it again',
		(route) => {
			const install = () =>
				installPlugins([definePlugin({ name: 'fills-a-slot', setup: route.register })]);
			install();
			resetPluginPlatformForTests();
			expect(route.isRegistered()).toBe(false);
			expect(install).not.toThrow();
			resetPluginPlatformForTests();
		}
	);
});
