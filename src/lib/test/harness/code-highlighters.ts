// An editor activation whose one plugin highlights the given languages, for a mounted block
// that reads the editor's highlighters (the code block's picker, its painter).
import { definePlugin, type CodeLanguage } from '#lib/plugin.js';
import { installPluginList } from '#lib/schema/plugin-unit.js';
import { createEditorContributions } from '#lib/schema/editor-contributions.js';
import { createEditorActivation, type PluginActivation } from '#lib/schema/plugin-activation.js';

export function activationHighlighting(languages: readonly CodeLanguage[]): PluginActivation {
	const report = (error: unknown) => {
		throw error;
	};
	const contributions = createEditorContributions({ editorFor: () => undefined, report });
	const plugin = definePlugin({
		name: 'stub-highlighter',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ code: { languages: () => languages, highlight: () => null } })
	});
	const units = contributions.read(installPluginList([plugin], report));
	return createEditorActivation(
		units.map((unit) => unit.name),
		contributions
	);
}
