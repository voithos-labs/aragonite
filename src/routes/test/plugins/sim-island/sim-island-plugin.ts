// Deterministic, content-keyed decoration source for the loaded-ops simulation. Three
// sentinels in leaf raws anchor one decoration tier each: `[>…<]` a replace island,
// `WIDGET` a zero-width widget island, `BADGE` a block decoration. They are absent from
// the other `?seed=sim` documents, so this stays inert there. Every position is re-derived
// from content each per-edit pass, so a decoration follows its bytes across typing.
import { definePlugin, type Decoration, type DocumentView, type NodeView } from '$lib/plugin';
import { forEachLeaf } from '../walk-views';

const REPLACE_OPEN = '[>';
const REPLACE_CLOSE = '<]';
const WIDGET_SENTINEL = 'WIDGET';
const BLOCK_SENTINEL = 'BADGE';

export const SIM_REPLACE_ISLAND_CLASS = 'sim-replace-island';
export const SIM_WIDGET_ISLAND_CLASS = 'sim-widget-island';
export const SIM_BADGED_BLOCK_CLASS = 'sim-badged-block';

export const simIslandPlugin = definePlugin({
	name: 'sim-island',
	setup(ctx) {
		ctx.onEditor((editor) => {
			const handle = editor.decorations.addSource({
				name: 'sim-island',
				provide: (doc) => islandDecorations(doc)
			});
			return () => handle.dispose();
		});
	}
});

function islandDecorations(doc: DocumentView): Decoration[] {
	const decorations: Decoration[] = [];
	forEachLeaf(doc.children, (node, path) => {
		collectReplaceIslands(node, path, decorations);
		collectWidgetIslands(node, path, decorations);
		if (node.raw.includes(BLOCK_SENTINEL)) {
			decorations.push({
				type: 'block',
				path,
				class: SIM_BADGED_BLOCK_CLASS,
				badge: { buildDom: () => badgeElement() }
			});
		}
	});
	return decorations;
}

function collectReplaceIslands(node: NodeView, path: number[], out: Decoration[]): void {
	let from = 0;
	for (;;) {
		const start = node.raw.indexOf(REPLACE_OPEN, from);
		if (start < 0) break;
		const close = node.raw.indexOf(REPLACE_CLOSE, start + REPLACE_OPEN.length);
		if (close < 0) break;
		const end = close + REPLACE_CLOSE.length;
		out.push({ type: 'replace', path, start, end, class: SIM_REPLACE_ISLAND_CLASS });
		from = end;
	}
}

// The widget sits at the sentinel word's leading edge, never inside it, so an adjacent
// insert or delete moves the anchor by one without dissolving the word.
function collectWidgetIslands(node: NodeView, path: number[], out: Decoration[]): void {
	let from = 0;
	for (;;) {
		const offset = node.raw.indexOf(WIDGET_SENTINEL, from);
		if (offset < 0) break;
		out.push({
			type: 'widget',
			path,
			offset,
			side: 'before',
			widget: { buildDom: () => widgetElement() }
		});
		from = offset + WIDGET_SENTINEL.length;
	}
}

function widgetElement(): HTMLElement {
	const el = document.createElement('span');
	el.className = 'sim-widget-island-content';
	return el;
}

function badgeElement(): HTMLElement {
	const el = document.createElement('span');
	el.className = 'sim-badge';
	el.textContent = 'B';
	return el;
}
