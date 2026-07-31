// Dogfood for the per-instance context spine: the working proof that document, identity,
// and events replace a state-field API.
import { definePlugin, registerGlobalCommand, type EditorContext } from '$lib/plugin';

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

function recompute(editor: EditorContext, edits: number) {
	const options = (editor.options as DocStatsOptions | undefined) ?? { label: 'default' };
	statsByEditor.set(editor.editorId, {
		label: options.label,
		blocks: editor.document.children.length,
		edits
	});
	publish();
}

export const docStatsPlugin = definePlugin<DocStatsOptions>({
	name: 'doc-stats',
	setup(ctx) {
		// recompute() keeps its options narrowing: registerGlobalCommand's handler
		// receives EditorContext<unknown> (the mint is not generic-bound).
		registerGlobalCommand(
			'docStats.publish',
			(editor) => {
				recompute(editor, statsByEditor.get(editor.editorId)?.edits ?? 0);
				return true;
			},
			{ chord: 'Mod+Shift+S' }
		);
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
