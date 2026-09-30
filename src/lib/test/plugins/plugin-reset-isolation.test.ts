// @vitest-environment jsdom
// A plugin author's suite, written against the published testing API: reset in `beforeEach`,
// re-install in each case, and every case sees exactly one install's registrations.
// Miss-analysis: the reset's test read a hand-kept list of registries, never the highlighter.
import { describe, it, expect, beforeEach } from 'vitest';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import { resetPluginPlatformForTests } from '$lib/testing';
import {
	definePlugin,
	highlightCode,
	registerBlockCompleter,
	registerBlockContextActions,
	registerInlineWidgetKind,
	registerLanguage
} from '$lib/plugin';
import { installPlugins } from '$lib/schema/plugin-install';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';
import {
	blockContextActionsFor,
	registerBuiltinBlockContextActions
} from '$lib/schema/context-actions';
import {
	isLanguageRegistered,
	registerBuiltinLanguage
} from '$lib/components/blocks/code/code-languages';
import { isBlockCompleterRegistered } from '$lib/schema/block-completions';
import { isInlineWidgetKind } from '$lib/core/inline/inline-widgets';
import { defaultGrammarView } from '$lib/schema/block-openers';
import type { LanguageFn } from 'highlight.js';
import type { NodeView } from '$lib/core/node-views';

const probeBlock = { kind: 'probe-rows', raw: 'x\n' } as unknown as NodeView;
const rowIds = () =>
	blockContextActionsFor(probeBlock, [0], everyInstalledPlugin, 'block').map((a) => a.id);

/** The highlighted spans, as `class:text`. */
const tokens = (body: string) =>
	[...highlightCode(body, 'probelang').childNodes]
		.filter((n) => n.nodeType === 1)
		.map((n) => `${(n as HTMLElement).className}:${n.textContent}`);
const BODY = 'def f(): pass\nconst x = 1';

function installRowsPlugin(grammar: LanguageFn): void {
	installPlugins([
		definePlugin({
			name: 'rows',
			setup() {
				registerBlockContextActions('probe-rows', 'rows', () => [
					{ id: 'rows.one', label: 'One', run: () => {} }
				]);
				registerLanguage('probelang', grammar);
			}
		})
	]);
}

describe('resetPluginPlatformForTests between cases', () => {
	beforeEach(() => resetPluginPlatformForTests());

	it('case 1 sees its own row and highlights with its own grammar', () => {
		installRowsPlugin(javascript);
		expect(rowIds()).toEqual(['rows.one']);
		expect(tokens(BODY)).toContain('code-tok-keyword:const');
	});

	it('case 2 sees one row, not one per earlier case, and highlights with its own grammar', () => {
		installRowsPlugin(python);
		expect(rowIds()).toEqual(['rows.one']);
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
				setup() {
					registerBuiltinBlockContextActions('probe-rows', 'lazy', () => [
						{ id: 'lazy.row', label: 'Lazy', run: () => {} }
					]);
					registerBuiltinLanguage('lazylang', python);
				}
			})
		]);
		resetPluginPlatformForTests();
		expect(rowIds()).toEqual(['lazy.row']);
		expect(isLanguageRegistered('lazylang')).toBe(true);
	});
});

// Miss-analysis: the reset tests registered plugin entries only for plugin kinds, so a reset that
// asked whose activation an entry answers to, not who registered it, kept a built-in kind's entry.
describe('a plugin’s entry for a built-in kind', () => {
	const routes = [
		{
			name: 'a block completer for paragraph',
			register: () => registerBlockCompleter('paragraph', { tryComplete: () => null }),
			isRegistered: () => isBlockCompleterRegistered('paragraph')
		},
		{
			name: 'an inline widget for emphasis',
			register: () =>
				registerInlineWidgetKind('emphasis', {
					isWidget: () => true,
					buildWidget: () => document.createElement('span')
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
