// An example of the per-instance context: the plugin reads the document, the editor's identity,
// its events and its options from it.
import { definePlugin, type EditorContext } from '#lib/plugin.js';

export interface DocStatsOptions {
	label: string;
}

interface StatsRecord {
	label: string;
	blocks: number;
	edits: number;
}

const statsByEditor = new Map<string, StatsRecord>();

declare global {
	interface Window {
		__docStats?: Record<string, StatsRecord>;
	}
}

function publish() {
	window.__docStats = Object.fromEntries(statsByEditor);
}

function recompute(editor: EditorContext<DocStatsOptions>, edits: number) {
	statsByEditor.set(editor.editorId, {
		label: editor.options.label,
		blocks: editor.document.children.length,
		edits
	});
	publish();
}

export const docStatsPlugin = definePlugin<DocStatsOptions>({
	name: 'doc-stats',
	defaults: { label: 'default' },
	setup(ctx) {
		ctx.onEditor((editor) => {
			let edits = 0;
			recompute(editor, edits);
			const off = editor.events.on('edit', () => recompute(editor, ++edits));
			return () => {
				off();
				statsByEditor.delete(editor.editorId);
				publish();
			};
		});
	}
});
