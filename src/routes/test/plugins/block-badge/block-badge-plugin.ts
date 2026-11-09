// A fixture for BlockDecoration through the public API only: every heading block gets a class
// and a badge widget, at any depth, which each block's own paint carries.
import { definePlugin, type Decoration, type DocumentView, type PluginView } from '#lib/plugin.js';
import { forEachLeaf } from '../../../walk-views';

// One view for every badge, so a badge whose heading is still there keeps its element.
const headingBadge: PluginView<{ decoration: Decoration }> = (target) => {
	const el = document.createElement('span');
	el.className = 'badge-h';
	el.textContent = 'H';
	target.append(el);
	return {};
};

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
	// Headings are always leaf blocks, so a leaf walk reaches every one at any depth.
	forEachLeaf(doc.children, (node, path) => {
		if (node.kind !== 'heading') return;
		badges.push({
			type: 'block',
			path,
			class: 'badge-heading',
			badge: { view: headingBadge }
		});
	});
	return badges;
}
