// @vitest-environment jsdom
// A plugin command registered with `overSelection` runs after the selection inside its block is
// removed, and reads the block as the removal left it; one registered without runs at the caret.
// Miss-analysis: the in-block removal is a dispatch step, so a row on built-in commands alone
// would pass with plugin commands skipping it.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	selectRange,
	surfaceAt
} from '$lib/test/harness/mount-editor.svelte';
import { pressKey, settleEditor } from '$lib/test/harness/settle';
import {
	augmentBlockKind,
	definePluginBlock,
	registerBlockCommand,
	registerBlockOpener,
	type BlockCommandContext,
	type EditorPlugin
} from '$lib/plugin';
import PlainOneLineLeafBlock from './fixtures/PlainOneLineLeafBlock.svelte';
import { registerRevealLeafKind } from './fixtures/reveal-leaf';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const KIND = 'verse-leaf';

/** An `@@ ` line with two commands that record the text they ran on, one asking for the removal. */
function verseLeafPlugin(ran: string[]): EditorPlugin {
	const handler = (ctx: BlockCommandContext) => {
		ran.push(ctx.node.raw);
		return true;
	};
	return definePluginBlock({
		name: KIND,
		kind: KIND,
		component: PlainOneLineLeafBlock,
		register: () => {
			const kind = registerRevealLeafKind(KIND);
			const removing = registerBlockCommand(kind, 'verseLeaf.break', handler, {
				overSelection: 'afterRemoval'
			});
			const atCaret = registerBlockCommand(kind, 'verseLeaf.mark', handler);
			augmentBlockKind(kind, {
				keymap: [
					{ chord: 'Mod+Shift+Enter', command: removing },
					{ chord: 'Mod+Shift+L', command: atCaret }
				]
			});
			registerBlockOpener(kind, {
				priority: 25,
				interruptsParagraph: false,
				tryOpen: (ctx) =>
					ctx.line.text.startsWith('@@ ')
						? { node: { kind, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw }, consumed: 1 }
						: null
			});
		}
	});
}

describe('a plugin command over a selection inside its block', () => {
	it.each([
		[
			'with `overSelection`, after the removal',
			{ key: 'Enter', ctrlKey: true, shiftKey: true },
			'@@ aha\n'
		],
		['without it, at the caret', { key: 'L', ctrlKey: true, shiftKey: true }, '@@ alpha\n']
	])('runs %s', async (_, key, text) => {
		const ran: string[] = [];
		const editor = mountEditor({ source: '@@ alpha\n', plugins: [verseLeafPlugin(ran)] });
		await settleEditor();
		selectRange(surfaceAt(editor, [0]), 4, 6);

		await pressKey(surfaceAt(editor, [0]), key);
		await settleEditor();

		expect(editor.source()).toBe(text);
		expect(ran).toEqual([text]);
	});
});
