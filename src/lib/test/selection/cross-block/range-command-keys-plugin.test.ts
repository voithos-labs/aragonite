// @vitest-environment jsdom
// A plugin command registered to run after a range's removal is a command key over a range in its
// own kind's blocks, on Enter and on a chord no built-in kind binds alike.
// Miss-analysis: every command-key row bound a built-in command, so no row asked a plugin's.
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt
} from '$lib/test/harness/mount-editor.svelte';
import { pressKey } from '$lib/test/harness/settle';
import {
	augmentBlockKind,
	definePluginBlock,
	registerBlockCommand,
	registerBlockOpener,
	type BlockCommandContext,
	type EditorPlugin
} from '$lib/plugin';
import RevealLeafBlock from '../../blocks/fixtures/RevealLeafBlock.svelte';
import { registerRevealLeafKind } from '../../blocks/fixtures/reveal-leaf';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

type Seam = { isCrossBlockActive(): boolean };

const KIND = 'pin-leaf';

/** An `@@ ` line whose two commands record the text they ran on. */
function pinLeafPlugin(ran: (text: string) => void): EditorPlugin {
	const handler = (ctx: BlockCommandContext) => {
		ran(ctx.node.raw);
		return true;
	};
	return definePluginBlock({
		name: KIND,
		kind: KIND,
		component: RevealLeafBlock,
		register: () => {
			const kind = registerRevealLeafKind(KIND);
			const options = { overRange: 'afterRemoval' } as const;
			const enter = registerBlockCommand(kind, 'pinLeaf.enter', handler, options);
			const mark = registerBlockCommand(kind, 'pinLeaf.mark', handler, options);
			augmentBlockKind(kind, {
				keymap: [
					{ chord: 'Enter', command: enter },
					{ chord: 'Mod+Shift+Enter', command: mark }
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

describe('a plugin command that runs after the removal, over a range', () => {
	for (const [name, key] of [
		['Enter', { key: 'Enter' }],
		['Mod+Shift+Enter', { key: 'Enter', ctrlKey: true, shiftKey: true }]
	] as const) {
		it(`${name} removes the range, then runs in the plugin's block`, async () => {
			const ran = vi.fn();
			const mounted = mountEditor<Seam>({
				source: '@@ one\n\nbeta\n',
				plugins: [pinLeafPlugin(ran)]
			});
			await mounted.settle();
			await mounted.instance.setSelection({
				anchor: { path: [0], offset: 4 },
				focus: { path: [1], offset: 2 }
			});
			await mounted.settle();

			await pressKey(surfaceAt(mounted, [1]), key);

			expect(mounted.source()).toBe('@@ ota\n');
			expect(ran).toHaveBeenCalledTimes(1);
			expect(ran).toHaveBeenCalledWith('@@ ota\n');
		});
	}
});
