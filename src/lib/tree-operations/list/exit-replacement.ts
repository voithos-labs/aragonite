import type { CstNode } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { metadataOf } from '../../core/nodes';
import { trailingLineEnding } from '../../core/lines';
import { cloneNode } from '../clone';
import { emptyParagraph } from '../node-ops';
import { assembleListHalf, orderedBaseOf } from './list-builders';

/**
 * Compute the parent-level replacement when a list item exits the list (Enter
 * on an empty-first-paragraph item). Layout:
 *   [firstHalfList?, exitParagraph, ...liftedBlocks, secondHalfList?]
 *
 * Matching-type nested list items rejoin the surviving list halves; everything
 * else lifts as separate top-level blocks in document order. `paragraphIndex`
 * is the exit paragraph's position in the returned array — callers pass it as
 * the focus target. Input is not mutated.
 */
export function buildExitReplacement(
	list: NodeView,
	itemIndex: number
): { blocks: CstNode[]; paragraphIndex: number } {
	const items = list.children ?? [];
	const exitedItem = items[itemIndex];
	const parentOrdered = metadataOf(list, 'list')?.ordered ?? false;

	// Matching-type nested lists flatten into `promotedItems` for re-merge
	// into the surviving halves; everything else lifts as a top-level block.
	const promotedItems: CstNode[] = [];
	const liftedBlocks: CstNode[] = [];
	if (exitedItem?.children && exitedItem.children.length > 1) {
		for (const child of exitedItem.children.slice(1)) {
			if (child.kind === 'list' && child.children) {
				const childOrdered = metadataOf(child, 'list')?.ordered ?? false;
				if (childOrdered === parentOrdered) {
					for (const nestedItem of child.children) {
						const cloned = cloneNode(nestedItem);
						cloned.leadingTrivia = '';
						promotedItems.push(cloned);
					}
					continue;
				}
			}
			const lifted = cloneNode(child);
			lifted.leadingTrivia = '';
			liftedBlocks.push(lifted);
		}
	}

	const before = items.slice(0, itemIndex).map(cloneNode);
	const after = items.slice(itemIndex + 1).map(cloneNode);

	// wasFirstItem has no `before` half, so promotions slide into `after`.
	const wasFirstItem = itemIndex === 0;
	const firstHalfItems = wasFirstItem ? [] : [...before, ...promotedItems];
	const secondHalfItems = wasFirstItem ? [...promotedItems, ...after] : after;

	// Every byte this op mints is a line ending, so it takes the list's (G4.20).
	const lineEnding = trailingLineEnding(list.raw);
	const exitParagraph = emptyParagraph('', lineEnding);

	// Preserve the original list's starting number across the split.
	const base = orderedBaseOf(items[0]);

	const blocks: CstNode[] = [];
	if (firstHalfItems.length > 0) {
		blocks.push(assembleListHalf(list, firstHalfItems, base));
		// The exit paragraph follows the surviving list; without a blank line the
		// parser lazy-continues a typed line into the list's last item on reload.
		exitParagraph.leadingTrivia = lineEnding;
	}
	const paragraphIndex = blocks.length;
	blocks.push(exitParagraph);
	for (const lifted of liftedBlocks) blocks.push(lifted);
	if (secondHalfItems.length > 0) {
		// Continue the sequence across the gap: base, base+1, [exit], base+2 —
		// the exited slot doesn't burn a number.
		const secondHalfStart = base + firstHalfItems.length;
		blocks.push(assembleListHalf(list, secondHalfItems, secondHalfStart));
	}

	return { blocks, paragraphIndex };
}
