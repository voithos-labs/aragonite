import { trimTrailingLineEnding } from '../../core/lines';
import type { NodeView } from '../../core/node-views';
import type { Caret } from './types';

export function caretInBlocks(
	blocks: readonly Pick<NodeView, 'leadingTrivia' | 'raw'>[],
	offset: number
): Caret {
	let start = 0;
	for (let index = 0; index < blocks.length; index++) {
		if (index > 0) start += blocks[index].leadingTrivia.length;
		if (offset < start) return { index, offset: 0 };
		const text = trimTrailingLineEnding(blocks[index].raw).length;
		if (offset <= start + text) return { index, offset: offset - start };
		start += blocks[index].raw.length;
	}
	const last = blocks.length - 1;
	return { index: last, offset: trimTrailingLineEnding(blocks[last]?.raw ?? '').length };
}
