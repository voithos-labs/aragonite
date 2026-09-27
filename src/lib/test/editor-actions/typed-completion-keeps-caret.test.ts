// A keystroke that an on-type completer turns into a structure hands the caret to the
// completion's replace, so the write must not tell its block to keep the caret.
// Miss-analysis: the `keepsCaret` cases never registered a completer, so none typed one's trigger.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetPluginPlatformForTests } from '$lib/testing';
import { definePlugin, installPlugins } from '$lib/schema/plugin-install';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { registerBlockCompleter } from '$lib/schema/block-completions';
import { serialize } from '$lib/core/serializer';
import { settleEditor } from '../harness/settle';
import { makeTopHarness } from '../harness/editor-actions';

const ruleBox = definePlugin({
	name: 'rule-box',
	setup() {
		registerBlockCompleter(declarePluginKind('rule-box'), {
			onType: true,
			tryComplete: (line) =>
				line === '%%%' ? { lines: ['%%%', 'x'], caret: { path: [], line: 1, column: 0 } } : null
		});
	}
});

beforeEach(() => {
	resetPluginPlatformForTests();
	installPlugins([ruleBox]);
});
afterEach(resetPluginPlatformForTests);

describe('a keystroke an on-type completer answers', () => {
	it('gives the caret up to the completion', async () => {
		const h = makeTopHarness('%%\n');

		const write = h.actions.updateBlockContent(0, '%%%\n', 'authored', 2, 3);
		expect(write.admitted && write.keepsCaret).toBe(false);
		await write;
		await settleEditor();

		expect(serialize(h.deps.doc)).toBe('%%%\nx\n');
	});

	it('keeps it when the typed line is not a trigger', async () => {
		const h = makeTopHarness('%%\n');

		const write = h.actions.updateBlockContent(0, '%%a\n', 'authored', 2, 3);
		expect(write.admitted && write.keepsCaret).toBe(true);
		await write;

		expect(serialize(h.deps.doc)).toBe('%%a\n');
	});
});
