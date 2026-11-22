/**
 * The blocks a block type's command runs on when it is handed none. At a caret, or a selection in
 * one block, that is the nearest block around it whose type places the command. Over a selection
 * across blocks it is each covered leaf's outermost such block, the leaves Tab over a range covers,
 * so a block the range reaches only the first byte of is left out.
 */
import type { DocumentView } from '../core/node-views';
import { nodeAt } from '../tree-operations/node-primitives';
import { pathsEqual } from './path-math';
import type { EditorSelection } from './primitives';
import { coverRange, forEachCoveredLeaf, rangeCoverage } from './range-coverage';

/** The paths, in document order, of the blocks of `kinds` a command over `selection` runs on;
 *  `across` where the selection runs across blocks. */
export function placingPaths(
	doc: DocumentView,
	{ anchor, focus }: EditorSelection,
	kinds: ReadonlySet<string>
): { paths: number[][]; across: boolean } {
	const places = (path: readonly number[]) => kinds.has(nodeAt(doc, path)?.kind ?? '');
	if (pathsEqual(anchor.path, focus.path)) {
		for (let depth = focus.path.length; depth >= 1; depth--) {
			const at = focus.path.slice(0, depth);
			if (places(at)) return { paths: [at], across: false };
		}
		return { paths: [], across: false };
	}
	const found = new Map<string, number[]>();
	forEachCoveredLeaf(doc, rangeCoverage(doc, coverRange(doc, anchor, focus)), (leaf) => {
		const at = leaf.slice(0, leaf.findIndex((_, i) => places(leaf.slice(0, i + 1))) + 1);
		if (at.length > 0) found.set(at.join(), at);
		return false;
	});
	return { paths: [...found.values()], across: true };
}
