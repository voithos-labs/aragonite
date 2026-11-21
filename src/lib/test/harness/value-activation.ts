// An activation carrying what these plugin values contribute, read the way one editor reads its
// list, so the command lookups resolve their commands and chords without a mounted editor.
import { createEditorContributions } from '#lib/schema/editor-contributions.js';
import { blockOf, DETACHED_READING } from '#lib/schema/doc-view.js';
import { everyInstalledPlugin, type PluginActivation } from '#lib/schema/plugin-activation.js';
import { installPluginList, type Editor, type PluginList } from '#lib/schema/plugin-unit.js';

export function valueActivation(
	plugins: PluginList,
	editor: Editor = {} as Editor,
	base: PluginActivation = everyInstalledPlugin
): PluginActivation {
	const thrown = ({ cause }: { cause: unknown }) => {
		throw cause;
	};
	const contributions = createEditorContributions({
		editorFor: () => editor,
		report: thrown,
		blocksAround: () => [],
		undoStep: (run) => run(),
		blockOf: (node) => blockOf(node, DETACHED_READING),
		clipboardBlocks: () => (node) => blockOf(node, DETACHED_READING)
	});
	contributions.read(installPluginList(plugins, thrown));
	return { isActive: base.isActive, contributions };
}
