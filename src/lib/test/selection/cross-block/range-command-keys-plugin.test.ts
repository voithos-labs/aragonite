// @vitest-environment jsdom
// A plugin command registered to run after a range's removal is a command key over a range in its
// own kind's blocks, on Enter and on a chord no built-in kind binds alike. Enter over whole blocks
// under one runs where text typed over them would land, not in the plugin's block.
// Miss-analysis: every command-key row bound a built-in command, so no row asked a plugin's.
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import {
	blockHostAt,
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import {
	augmentBlockKind,
	definePlugin,
	registerBlockCommand,
	type BlockCommandContext,
	type EditorPlugin
} from '#lib/plugin.js';
import { svelteBlockView } from '#lib/svelte.js';
import type { EditorSelection } from '#lib/selection/primitives.js';
import RevealLeafBlock from '../../blocks/fixtures/RevealLeafBlock.svelte';
import { registerRevealLeafKind } from '../../blocks/fixtures/reveal-leaf';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

type Seam = { ownsRange(): boolean };

const KIND = 'pin-leaf';

/** An `@@ ` line whose two commands record the text they ran on. */
function pinLeafPlugin(ran: (text: string) => void): EditorPlugin {
	const handler = (ctx: BlockCommandContext) => {
		ran(ctx.node.raw);
		return true;
	};
	return definePlugin({
		name: KIND,
		setup: () => {
			const kind = registerRevealLeafKind(KIND, (kind) => ({
				opener: {
					priority: 25,
					interruptsParagraph: false,
					tryOpen: (ctx) =>
						ctx.line.text.startsWith('@@ ')
							? { node: { kind, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw }, consumed: 1 }
							: null
				},
				view: svelteBlockView(RevealLeafBlock)
			}));
			const options = { overRange: 'afterRemoval' } as const;
			const enter = registerBlockCommand(kind, 'pinLeaf.enter', handler, options);
			const mark = registerBlockCommand(kind, 'pinLeaf.mark', handler, options);
			augmentBlockKind(kind, {
				keymap: [
					{ chord: 'Enter', command: enter },
					{ chord: 'Mod+Shift+Enter', command: mark }
				]
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

			// The kind takes no joined text, so what follows the range keeps its own line.
			expect(mounted.source()).toBe('@@ o\nta\n');
			expect(ran).toHaveBeenCalledTimes(1);
			expect(ran).toHaveBeenCalledWith('@@ o\n');
		});
	}

	// Over whole blocks the place a line break takes is a paragraph opened where they stood, so the
	// keymap read is that paragraph's, not the plugin block's above.
	it('Enter over whole blocks under the plugin block opens a line where they stood', async () => {
		const enterOverWholeBlocks = async (plugins: EditorPlugin[]) => {
			const source = '@@ one\n\n---\n\n***\n';
			const mounted = mountEditor<Seam>({ source, plugins });
			await mounted.settle();
			// The public selection names text positions; the editor's restore takes blocks held whole too.
			const dividers = {
				anchor: { path: [1], wholeBlock: true },
				focus: { path: [2], wholeBlock: true }
			} as unknown as EditorSelection;
			await mounted.instance.setSelection(dividers);
			await mounted.settle();
			await pressKey(blockHostAt(mounted, [2]), { key: 'Enter' });
			const after = mounted.source();
			await destroyMountedEditors();
			return after;
		};
		const ran = vi.fn();

		const withPlugin = await enterOverWholeBlocks([pinLeafPlugin(ran)]);

		expect(ran).not.toHaveBeenCalled();
		expect(withPlugin).toBe('@@ one\n\n\n');
		expect(withPlugin).toBe(await enterOverWholeBlocks([]));
	});
});
