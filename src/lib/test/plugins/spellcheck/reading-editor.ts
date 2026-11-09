// A mounted editor as a plugin's `setup` sees it, so the spell check's reads and writes run on the
// editor's own `blockAt` and `edit`. The suite installs the layout stubs and tears editors down.
import { definePlugin, type Block, type Editor } from '#lib/plugin.js';
import { mountEditor, type MountedEditor } from '#lib/test/harness/mount-editor.svelte.js';

export async function readingEditor(source: string): Promise<{ editor: Editor; m: MountedEditor }> {
	let editor: Editor | undefined;
	const reader = definePlugin({
		name: 'spell-reader',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ setup: (mounted) => void (editor = mounted) })
	});
	const m = mountEditor({ source, plugins: [reader] });
	await m.settle();
	return { editor: editor!, m };
}

/** The block holding byte `at` of `source`, read off a mounted editor. */
export async function blockIn(source: string, at: number): Promise<Block> {
	const block = (await readingEditor(source)).editor.blockAt(at);
	if (!block) throw new Error(`no block at ${at}`);
	return block;
}
