// @vitest-environment jsdom
// A keystroke that an on-type completer turns into a structure: the typed caret goes back first,
// so the completion's undo entry holds it, then the completion puts the caret in what it made.
// Miss-analysis: the `keepsCaret` cases never registered a completer, so none typed one's trigger.
import { beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { definePlugin, installPlugins } from '$lib/schema/plugin-install';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { registerBlockCompleter } from '$lib/schema/block-completions';
import { rawSelectionFocus } from '$lib/cursor/widget-offset';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	typeInto
} from '../harness/mount-editor.svelte';

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

beforeAll(installLayoutStubs);
beforeEach(() => {
	installPlugins([ruleBox]);
});
afterEach(destroyMountedEditors);

describe('a keystroke an on-type completer answers', () => {
	it('forms the structure, with the caret where the completion put it', async () => {
		const editor = mountEditor({ source: '%%\n' });
		typeInto(surfaceAt(editor, [0]), '%%%');
		await editor.settle();

		expect(editor.source()).toBe('%%%\nx\n');
		expect(rawSelectionFocus(surfaceAt(editor, [0]))).toBe(4);
	});

	it('leaves a line that is not a trigger as typed', async () => {
		const editor = mountEditor({ source: '%%\n' });
		typeInto(surfaceAt(editor, [0]), '%%a');
		await editor.settle();

		expect(editor.source()).toBe('%%a\n');
		expect(rawSelectionFocus(surfaceAt(editor, [0]))).toBe(3);
	});
});
