// Fixture for BlockDecoration on public doors only: every heading host gets a
// class plus a badge widget (blockDecorationsForPath's consumer), at any depth.
import { definePlugin, type Decoration, type DocumentView, type NodeView } from '$lib/plugin';

export const blockBadgePlugin = definePlugin({
	name: 'block-badge',
	setup(ctx) {
		ctx.onEditor((editor) => {
			const handle = editor.decorations.addSource({
				name: 'block-badge',
				provide: (doc) => headingBadges(doc)
			});
			return () => handle.dispose();
		});
	}
});

function headingBadges(doc: DocumentView): Decoration[] {
	const badges: Decoration[] = [];
	walk(doc.children, []);
	return badges;

	function walk(children: readonly NodeView[], path: number[]): void {
		children.forEach((node, i) => {
			const childPath = [...path, i];
			if (node.kind === 'heading') {
				badges.push({
					type: 'block',
					path: childPath,
					class: 'badge-heading',
					badge: {
						buildDom: () => {
							const el = document.createElement('span');
							el.className = 'badge-h';
							el.textContent = 'H';
							return el;
						}
					}
				});
			}
			if (node.children) walk(node.children, childPath);
		});
	}
}
