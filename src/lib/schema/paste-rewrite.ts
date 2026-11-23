/** A plugin's paste rewrite: Markdown for each pasted block of one type, wherever a paste lands as
 *  blocks. `rewrite()` makes one, reading the block's data type from `from`. */
import type { Block } from './doc-view';
import type { BlockType, Editor } from './plugin-unit';

/** Rewrites pasted blocks of one type wherever a paste lands as blocks; never on plain text, one
 *  line pasted into text, the editor's own copy, or Markdown a draft, a pick or an insert row
 *  puts in. */
export interface PasteRewrite<D = never> {
	from: BlockType<D>;
	/** Markdown for the block's place ('' leaves it out), or null to keep it; positions in `block`
	 *  count from the clipboard's start. */
	into(block: Block<D>, ctx: { readonly editor: Editor }): string | null;
}

/** A paste rewrite whose `into` reads the data of `from`'s blocks. */
export function rewrite<D>(spec: PasteRewrite<D>): PasteRewrite<D> {
	return spec;
}
