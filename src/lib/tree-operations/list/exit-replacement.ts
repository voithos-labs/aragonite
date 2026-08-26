import type { CstNode } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { metadataOf } from '../../core/nodes';
import { trailingLineEnding } from '../../core/lines';
import { cloneNode } from '../clone';
import { emptyParagraph } from '../node-ops';
import { assembleListHalf } from './list-builders';
import { partitionItemChildren } from './item-partition';
import { orderedBaseOf } from './ordered-markers';

/**
 * The parent-level replacement when a list item exits its list, laid out as
 * `[firstHalfList?, exitParagraph, ...liftedBlocks, secondHalfList?]`. Matching-type
 * nested items rejoin the surviving halves; everything else lifts as a top-level block.
 * `paragraphIndex` is the exit paragraph's slot, the caller's focus target. Input is not
 * mutated.
 */
export function buildExitReplacement(
	list: NodeView,
	itemIndex: number
): { blocks: CstNode[]; paragraphIndex: number } {
	const items = list.children ?? [];
	const exitedItem = items[itemIndex];
	const parentOrdered = metadataOf(list, 'list')?.ordered ?? false;

	// Child 0 is the exiting paragraph, which the fresh one below replaces.
	const { promotedItems, liftedBlocks } = partitionItemChildren(
		(exitedItem?.children ?? []).slice(1),
		parentOrdered
	);

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
		// Continue the sequence across the gap: the exited slot doesn't burn a number.
		const secondHalfStart = base + firstHalfItems.length;
		blocks.push(assembleListHalf(list, secondHalfItems, secondHalfStart));
	}

	return { blocks, paragraphIndex };
}
