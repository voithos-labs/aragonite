// The marks a mounted editor holds over the block at a path, as that block's text reads them, for a
// plugin suite in jsdom, where no overlay is ever measured onto the page.
import type { DocumentView } from '#lib/core/node-views.js';
import type { DecorationEngine } from '#lib/decorations/decoration-state.svelte.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import type { MountedEditor } from './mount-editor.svelte';

type Seam = { getDecorationEngine(): DecorationEngine; getDocument(): DocumentView };

/** The text under each mark of class `cls` on the block at `path`, in order. */
export function paintedMarks(m: MountedEditor, path: number[], cls: string): string[] {
	const seam = (m as MountedEditor<Seam>).instance.__test;
	const node = blockNodeAt(seam.getDocument(), path);
	if (!node) throw new Error(`no block at [${path.join(', ')}]`);
	return seam
		.getDecorationEngine()
		.paintOf(node, path)
		.marks.filter(({ dec }) => dec.class === cls)
		.map(({ dec }) => node.raw.slice(dec.start, dec.end));
}
