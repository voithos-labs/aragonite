// A plugin author's suite, written against the published testing API: reset in `beforeEach`,
// re-install in each case, and every case sees exactly one install's registrations.
// Miss-analysis: the reset's own test probed a hand-kept list of registries, so the two it
// skipped (context actions, languages) leaked between cases with nothing to notice.
import { describe, it, expect, beforeEach } from 'vitest';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import { resetPluginPlatformForTests } from '$lib/testing';
import { definePlugin, registerBlockContextActions, registerLanguage } from '$lib/plugin';
import { installPlugins } from '$lib/schema/plugin-install';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';
import { blockContextActionsFor } from '$lib/schema/context-actions';
import { getLanguageGrammar } from '$lib/components/blocks/code/code-languages';
import type { LanguageFn } from 'highlight.js';
import type { NodeView } from '$lib/core/node-views';

const probeBlock = { kind: 'probe-rows', raw: 'x\n' } as unknown as NodeView;
const rowIds = () => blockContextActionsFor(probeBlock, [0], everyInstalledPlugin).map((a) => a.id);

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

	it('case 1 sees its own row and language', () => {
		installRowsPlugin(javascript);
		expect(rowIds()).toEqual(['rows.one']);
		expect(getLanguageGrammar('probelang')?.definition).toBe(javascript);
	});

	it('case 2 sees one row, not one per earlier case, and its own language', () => {
		installRowsPlugin(python);
		expect(rowIds()).toEqual(['rows.one']);
		expect(getLanguageGrammar('probelang')?.definition).toBe(python);
	});
});
