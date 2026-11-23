/** A plugin's paste rewrites: Markdown for the whole paste, which `pasteRewrite()` makes, or for
 *  each pasted block of one type, which `blockRewrite()` makes, reading its data type from `from`. */
import type { Block, Doc } from './doc-view';
import type { BlockType, Editor } from './plugin-unit';

/** Rewrites a whole paste before the editor reads where it lands; never plain text, the editor's
 *  own copy, a paste into code, or Markdown a draft, a pick or an insert row puts in. */
export interface PasteRewrite {
	/** Names its `check` row and its excuse; unique in the plugin. */
	name: string;
	/** A paste it rewrites, which `check` pastes. */
	sample: string;
	/** Markdown for the whole paste ('' pastes nothing), or null to keep it. `pasted.text` is the
	 *  paste as the rewrite listed before left it, with LF line endings. */
	into(pasted: Doc, ctx: { readonly editor: Editor }): string | null;
}

/** A whole-paste rewrite, listed in `pasteRewrites`. */
export function pasteRewrite(spec: PasteRewrite): PasteRewrite {
	return spec;
}

/** Rewrites pasted blocks of one type wherever a paste lands as blocks; never on plain text, one
 *  line pasted into text, the editor's own copy, or Markdown a draft, a pick or an insert row
 *  puts in. */
export interface BlockRewrite<D = never> {
	from: BlockType<D>;
	/** Markdown for the block's place ('' leaves it out), or null to keep it; positions in `block`
	 *  count from the start of `pasted`, the paste as the whole-paste rewrites left it. */
	into(block: Block<D>, ctx: { readonly editor: Editor; readonly pasted: Doc }): string | null;
}

/** A block rewrite whose `into` reads the data of `from`'s blocks. */
export function blockRewrite<D>(spec: BlockRewrite<D>): BlockRewrite<D> {
	return spec;
}
