import type { BlockView } from '../../../schema/block-view';
import { svelteBlockView } from '../../svelte-block-view';
import TextEditableBlock from './TextEditableBlock.svelte';

/** The editor's own plain editable text block as a view, the one paragraphs and raw kinds use;
 *  `blockClass` lands on its element, and `sourceAtCaret` shows its markers while focused. */
export function textBlockView(
	opts: { blockClass?: string; sourceAtCaret?: boolean } = {}
): BlockView {
	const { blockClass, sourceAtCaret } = opts;
	return svelteBlockView(TextEditableBlock, () => ({
		blockClass,
		...(sourceAtCaret ? { sourceAtCaret } : {})
	}));
}

/** How raw built-in kinds and a kind whose view an editor can't resolve show: their bytes, as
 *  plain editable text. */
export const RAW_TEXT_VIEW = textBlockView({ blockClass: 'raw-block' });
