// @vitest-environment jsdom
// Miss-analysis: every activation test filled a slot on a plugin's own kind, so a plugin's entry
// on a built-in kind, which no plugin declares, resolving in every editor never showed.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetPluginPlatformForTests } from '$lib/testing';
import { definePlugin, installPlugins } from '$lib/schema/plugin-install';
import { registerBlockCompleter, completeTypedLine } from '$lib/schema/block-completions';
import { isInlineWidgetKind, registerInlineWidgetKind } from '$lib/core/inline/inline-widgets';
import { grammarListing } from './grammar-listing';

const LINE = 'fill-me';

beforeEach(() => {
	resetPluginPlatformForTests();
	installPlugins([
		definePlugin({
			name: 'slot-filler',
			setup() {
				registerBlockCompleter('paragraph', {
					tryComplete: (line) =>
						line === LINE ? { lines: ['filled'], caret: { path: [], line: 0, column: 0 } } : null
				});
				registerInlineWidgetKind('emphasis', {
					isWidget: () => true,
					buildWidget: () => document.createElement('span')
				});
			}
		})
	]);
});
afterEach(resetPluginPlatformForTests);

describe('a plugin’s entry on a built-in kind answers to that plugin', () => {
	it.each([
		[
			'a block completer for paragraph',
			(names: string[]) => completeTypedLine(LINE, grammarListing(names)) !== null
		],
		[
			'an inline widget for emphasis',
			(names: string[]) => isInlineWidgetKind('emphasis', grammarListing(names))
		]
	] as const)('%s resolves only where the plugin is listed', (_route, resolves) => {
		expect(resolves(['slot-filler'])).toBe(true);
		expect(resolves([])).toBe(false);
	});
});
