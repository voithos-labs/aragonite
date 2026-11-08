// A plugin value whose one command counts its chord's presses per editor, under the editor's
// `label` option, in `window.__chordCounts`. It writes nothing to the document.
import { command, definePlugin } from '#lib/plugin.js';

declare global {
	interface Window {
		__chordCounts?: Record<string, number>;
	}
}

export const chordCountPlugin = definePlugin<{ label: string }>({
	name: 'chord-count',
	version: '1.0.0',
	editor: '*',
	defaults: { label: 'default' },
	contributes: ({ label }) => ({
		commands: [
			command({
				id: 'count',
				title: 'Count a press',
				chord: 'Mod+Shift+S',
				run() {
					const counts = (window.__chordCounts ??= {});
					counts[label] = (counts[label] ?? 0) + 1;
				}
			})
		]
	})
});
