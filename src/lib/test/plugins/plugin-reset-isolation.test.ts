// @vitest-environment jsdom
//
// A plugin author's suite, written against the published testing API: reset in `beforeEach`,
// re-install in each case, and every case sees exactly one install's registrations.
// Miss-analysis: the reset's own test probed a hand-kept list of registries, so the two it
// skipped (context actions, languages) leaked between cases with nothing to notice; and the
// language case read the registry, never the highlighting, so the copy highlight.js keeps of
// each grammar leaked past a reset that had cleared the registry.
import { describe, it, expect, beforeEach } from 'vitest';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import { resetPluginPlatformForTests } from '$lib/testing';
import {
	definePlugin,
	highlightCode,
	registerBlockContextActions,
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

// Miss-analysis: every built-in registered at startup, outside any install, so none recorded a
// plugin that a later reset would read as the owner and drop.
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
