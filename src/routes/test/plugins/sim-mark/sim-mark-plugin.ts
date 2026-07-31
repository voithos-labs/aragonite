// Standing benign mark source for the loaded-ops simulations, re-run on every edit through
// the engine's per-edit pass. Marks are view-only (overlay spans; no CST, source, or undo
// change), so the corruption oracles hold while watching the decoration engine run on every
// keystroke. Installed only under `?seed=sim`: leaked into the scripted decoration battery,
// its marks would perturb those exact-overlay-count assertions.
import { definePlugin } from '$lib/plugin';
import type { DocumentView, MarkDecoration } from '$lib/plugin';
import { forEachLeaf } from '../walk-views';

// Whole-word-present in both loaded-ops fixtures (PLUGIN_DOC, DIRECTIVE_DOC).
const MARKED_WORD = 'paragraph';
export const SIM_MARK_CLASS = 'sim-standing-mark';

const WORD_CHAR = /[\p{L}\p{N}_]/u;

export const simMarkPlugin = definePlugin({
	name: 'sim-standing-mark',
	setup(ctx) {
		ctx.onEditor((editor) => {
			const handle = editor.decorations.addSource({
				name: 'sim-standing-mark',
				provide: (doc) => standingMarks(doc)
			});
			return () => handle.dispose();
		});
	}
});

function standingMarks(doc: DocumentView): MarkDecoration[] {
	const marks: MarkDecoration[] = [];
	forEachLeaf(doc.children, (node, path) => {
		const text = node.raw;
		for (
			let i = text.indexOf(MARKED_WORD);
			i !== -1;
			i = text.indexOf(MARKED_WORD, i + MARKED_WORD.length)
		) {
			const before = i > 0 ? text[i - 1] : '';
			const after = i + MARKED_WORD.length < text.length ? text[i + MARKED_WORD.length] : '';
			if ((!before || !WORD_CHAR.test(before)) && (!after || !WORD_CHAR.test(after))) {
				marks.push({
					type: 'mark',
					path,
					start: i,
					end: i + MARKED_WORD.length,
					class: SIM_MARK_CLASS
				});
			}
		}
	});
	return marks;
}
