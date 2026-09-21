/**
 * In-body tags the OTHER way: a mark decoration over ordinary text, not an atomic inline widget.
 * A tag's source IS its display, so a widget's reveal has nothing to uncover, while the island it
 * mints costs the caret that could otherwise walk through the tag. A mark paints over the text and
 * changes nothing else: the caret steps character by character, Backspace takes one byte, and
 * selection, copy and IME stay the browser's own. The decoration engine re-runs `provide` on every
 * document change, so the chip follows the bytes with no invalidation of its own.
 */ import { definePlugin } from '$lib/plugin';
import type { DocumentView, EditorPlugin, MarkDecoration } from '$lib/plugin';
import { forEachLeaf } from '../walk-views';
import { recognizeTag } from './tag-scan';

export const TAG_MARK_CLASS = 'body-tag-mark';

export function tagMarksPlugin(): EditorPlugin {
	return definePlugin({
		name: 'harness-tag-marks',
		setup(ctx) {
			ctx.onEditor((editor) => {
				const handle = editor.decorations.addSource({
					name: 'harness-tag-marks',
					provide: (doc) => tagMarks(doc)
				});
				return () => handle.dispose();
			});
		}
	});
}

function tagMarks(doc: DocumentView): MarkDecoration[] {
	const marks: MarkDecoration[] = [];
	forEachLeaf(doc.children, (node, path) => {
		const raw = node.raw;
		for (let i = raw.indexOf('#'); i !== -1; i = raw.indexOf('#', i + 1)) {
			const span = recognizeTag(raw, i, raw.length);
			if (!span) continue;
			marks.push({
				type: 'mark',
				path,
				start: span.start,
				end: span.end,
				class: TAG_MARK_CLASS,
				attrs: { 'data-tag': span.name }
			});
			i = span.end - 1;
		}
	});
	return marks;
}
