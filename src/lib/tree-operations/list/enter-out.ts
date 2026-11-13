/**
 * Enter on a list item it takes out of its list, written off to the side: the document a range edit
 * reads, left as it was, and a copy holding what the editor's own Enter leaves there. The item lifts
 * a level where its list sits in an item (`liftItemOut`), else exits to an empty paragraph
 * (`buildExitReplacement`), each followed by the fix-up its commit runs over the list it splices.
 */

import type { CstNode, Document } from '../../core/nodes';
import type { DocumentView } from '../../core/node-views';
import { documentLineEnding } from '../../core/lines';
import type { GrammarView } from '../../schema/block-openers';
import { rebuildContainerRaw } from '../../schema/container-raw';
import { spliceFixedUp } from '../fix-up/apply';
import { attachedChainPrefix, normalizeReplacementTrivia } from '../node-primitives';
import { detachedSharing } from '../sharing';
import { ensureUnsharedPath, rebuildOwnedContainer } from '../unshare';
import { leavesOnEnter } from './empty-check';
import { buildExitReplacement } from './exit-replacement';
import { liftItemOut } from './item-moves';

/** The document Enter leaves on the item at `path`, and the path of the block whose start takes the
 *  caret; null where Enter there opens an item, or lifts nothing. */
export function enteredOut(
	view: DocumentView,
	path: readonly number[],
	grammar: GrammarView
): { doc: Document; caret: number[] } | null {
	// A root of its own: the view's may be the editor's, whose id array a splice would write.
	const doc: Document = {
		kind: 'document',
		prefix: view.prefix,
		children: [...view.children],
		suffix: view.suffix
	} as Document;
	const sharing = detachedSharing();
	const lineEnding = documentLineEnding(view);
	const chain = ensureUnsharedPath(doc, [...path], sharing);
	const item = chain.at(-1);
	if (!item || !leavesOnEnter(item)) return null;
	const listAt = path.length - 2;
	// The list's own item holder, as Enter reads it: the nearest item around the list.
	const holder = chain.findLastIndex((node, i) => i < listAt && node.kind === 'listItem');
	const spliceBelow =
		(root: CstNode) => (rel: readonly number[], at: number, n: number, add: CstNode[]) =>
			spliceFixedUp(
				ensureUnsharedPath({ children: root.children! }, [...rel], sharing).at(-1) ?? root,
				at,
				n,
				add,
				grammar,
				sharing,
				lineEnding
			);
	let caret: number[];
	if (holder >= 0) {
		// Enter lifts only an item whose list is its holder's own child.
		if (holder !== listAt - 1) return null;
		const [outer, parent, nested] = chain.slice(listAt - 2, listAt + 1);
		const at = {
			parentItemIdx: path[listAt - 1],
			nestedIdxInParent: path[listAt],
			nestedItemIdx: path[listAt + 1]
		};
		const lifted = liftItemOut(at, {
			outer,
			nested,
			parent,
			sharing,
			rebuild: rebuildOwnedContainer,
			splice: spliceBelow(outer)
		});
		caret = [...path.slice(0, listAt - 1), lifted];
	} else {
		const body = chain[listAt - 1] ?? doc;
		const list = chain[listAt];
		const exit = buildExitReplacement(list, path[listAt + 1], lineEnding);
		const blocks = normalizeReplacementTrivia(list, exit.blocks);
		spliceFixedUp(body, path[listAt], 1, blocks, grammar, sharing, lineEnding);
		caret = [...path.slice(0, listAt), path[listAt] + exit.paragraphIndex];
	}
	// Innermost first, as the commit rebuilds its chains: an outer raw joins the inner ones.
	for (const node of attachedChainPrefix(doc, chain.slice(0, -1)).reverse())
		rebuildContainerRaw(node, grammar);
	return { doc, caret };
}
