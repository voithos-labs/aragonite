// Dogfood for the widget-island render path on public doors only: one
// component widget at the focused paragraph's end, moved by invalidating on
// selectionChange. Its e2e battery is the byte-safety proof — typing near the
// island never captures the ghost text into getSource().
import {
	definePlugin,
	trimTrailingLineEnding,
	type DocumentView,
	type NodeView
} from '$lib/plugin';
import GhostText from './GhostText.svelte';

function nodeAt(doc: DocumentView, path: number[]): NodeView | null {
	let children: readonly NodeView[] | undefined = doc.children;
	let node: NodeView | null = null;
	for (const index of path) {
		node = children?.[index] ?? null;
		if (!node) return null;
		children = node.children;
	}
	return node;
}

export const ghostTextPlugin = definePlugin({
	name: 'ghost-text',
	setup(ctx) {
		ctx.onEditor((editor) => {
			let focusPath: number[] | null = null;
			const handle = editor.decorations.addSource({
				name: 'ghost-text',
				provide(doc) {
					if (!focusPath) return [];
					const node = nodeAt(doc, focusPath);
					if (!node || node.kind !== 'paragraph') return [];
					return [
						{
							type: 'widget',
							path: focusPath,
							// Island offsets live in the block's raw-content space, which
							// excludes the trailing line ending.
							offset: trimTrailingLineEnding(node.raw).length,
							widget: { component: GhostText }
						}
					];
				}
			});
			const off = editor.events.on('selectionChange', (sel) => {
				// A table endpoint's offset is a cell index, not a raw offset — no ghost.
				focusPath = sel && !sel.focus.cellCoordinate ? sel.focus.path : null;
				handle.invalidate();
			});
			return () => {
				off();
				handle.dispose();
			};
		});
	}
});
