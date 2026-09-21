// A harmless mark source that stays installed for the loaded-ops simulations, re-run on every
// edit. Marks are view-only (overlay spans, with no change to the CST, the source or the undo
// stack), so the simulation's corruption checks still hold while the decoration engine runs on
// every keystroke. Installed only under `?seed=sim`: in the scripted decoration suite its marks
// would upset the exact overlay counts.
import { definePlugin } from '$lib/plugin';
import type { DocumentView, MarkDecoration } from '$lib/plugin';
import { forEachLeaf } from '../../../walk-views';

// Present as a whole word in both loaded-ops fixtures (PLUGIN_DOC, DIRECTIVE_DOC).
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
