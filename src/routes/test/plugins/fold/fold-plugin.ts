// Fixture for ReplaceDecoration.widget on public doors only: `[>…<]` ranges in
// leaf raws fold to a clickable `…` island (interactive DOM inside an island is
// native), and the click reopens the range through invalidate(). Folded bytes
// live only in the CST — the island stands for them in the DOM.
import { definePlugin, type Decoration, type DocumentView, type NodeView } from '$lib/plugin';

const OPEN = '[>';
const CLOSE = '<]';

interface FoldRange {
	path: number[];
	start: number;
	end: number;
}

export const foldPlugin = definePlugin({
	name: 'fold',
	setup(ctx) {
		ctx.onEditor((editor) => {
			const opened = new Set<string>();
			const handle = editor.decorations.addSource({
				name: 'fold',
				provide: (doc) =>
					findFoldRanges(doc)
						.filter((range) => !opened.has(keyOf(range)))
						.map(
							(range): Decoration => ({
								type: 'replace',
								path: range.path,
								start: range.start,
								end: range.end,
								class: 'fold-island',
								widget: {
									buildDom: () => {
										const el = document.createElement('span');
										el.className = 'fold-ellipsis';
										el.textContent = '…';
										el.style.cursor = 'pointer';
										el.addEventListener('click', () => {
											opened.add(keyOf(range));
											handle.invalidate();
										});
										return el;
									}
								}
							})
						)
			});
			return () => handle.dispose();
		});
	}
});

function keyOf(range: FoldRange): string {
	return `${range.path.join('.')}:${range.start}`;
}

function findFoldRanges(doc: DocumentView): FoldRange[] {
	const ranges: FoldRange[] = [];
	walk(doc.children, []);
	return ranges;

	function walk(children: readonly NodeView[], path: number[]): void {
		children.forEach((node, i) => {
			const childPath = [...path, i];
			if (node.children) {
				walk(node.children, childPath);
				return;
			}
			let from = 0;
			for (;;) {
				const start = node.raw.indexOf(OPEN, from);
				if (start < 0) break;
				const close = node.raw.indexOf(CLOSE, start + OPEN.length);
				if (close < 0) break;
				ranges.push({ path: childPath, start, end: close + CLOSE.length });
				from = close + CLOSE.length;
			}
		});
	}
}
