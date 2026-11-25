/**
 * Where the document sits on screen, as a plugin and a host read it through `editor.view`; the
 * editor's own `editor-view.ts` builds it over the rects its menus measure with.
 */
import type { Block } from './doc-view';

/** Where the document sits on screen: every position a document byte, every box a viewport
 *  rect. A block not mounted (scrolled far off) has no box until `reveal` brings it in. A block
 *  read from another editor or a parsed document isn't placed here, as one that left isn't. */
export interface View {
	/** The block's box; null while it isn't mounted, or once it has left the document. */
	boxOf(block: Block): DOMRect | null;
	/** The boxes covering bytes `[from, to)`: one per line of text it crosses, one per cell. */
	boxesOf(range: { readonly from: number; readonly to: number }): readonly DOMRect[];
	/** The caret's box while it sits in one block; null with none, or a range across blocks. */
	caretBox(): DOMRect | null;
	/** The byte a click at a viewport point would put the caret at, placing nothing; null outside
	 *  the editor, or where such a click places nothing. */
	posAt(point: { readonly x: number; readonly y: number }): number | null;
	/** Scrolls the block, or the block holding byte `target`, into view, mounting it first; true
	 *  once it's in view, false for a block that isn't placed (its `from` is -1). */
	reveal(
		target: Block | number,
		options?: { readonly align?: 'nearest' | 'center' | 'start' }
	): Promise<boolean>;
	/** Pins `el` at the top-left of the block's box (or a byte's character) through scrolls and edits
	 *  until the returned call or the block isn't placed (typing in it); `gone` hears it come off. */
	overlay(el: HTMLElement, at: Block | number, gone?: () => void): () => void;
}

/** The editor's view, with what its plugins' scoped editors need besides. */
export interface EditorView {
	readonly view: View;
	/** Takes every overlay off, as the editor unmounts. */
	dispose(): void;
}
