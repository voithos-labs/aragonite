// @vitest-environment jsdom
// A plugin author's suite, written against the published testing API: reset in `beforeEach`,
// re-install in each case, and every case sees exactly one install's registrations.
import { describe, it, expect, beforeEach } from 'vitest';
import { applyPasteTransforms, resetPluginPlatformForTests } from '#lib/testing.js';
import {
	definePlugin,
	registerBlockCompleter,
	registerInlineWidgetKind,
	registerPasteTransform
} from '#lib/plugin.js';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { completeTypedLine } from '#lib/schema/block-completions.js';
import { isInlineWidgetKind } from '#lib/core/inline/inline-widgets.js';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';

function installRewrite(to: string): void {
	const transform = (text: string) => (text === 'probe' ? to : null);
	installPlugins([
		definePlugin({
			name: 'rows',
			setup: () => registerPasteTransform({ name: 'probe-rewrite', transform })
		})
	]);
}

describe('resetPluginPlatformForTests between cases', () => {
	beforeEach(() => resetPluginPlatformForTests());

	it('case 1 pastes through its own transform', () => {
		installRewrite('one');
		expect(applyPasteTransforms('probe')).toBe('one');
	});

	it("case 2 pastes through its own transform, not an earlier case's", () => {
		installRewrite('two');
		expect(applyPasteTransforms('probe')).toBe('two');
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
