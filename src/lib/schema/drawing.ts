/**
 * How a plugin draws a block type: `draw(block, ctx)` builds the block's DOM around the elements the
 * editor hands it (the source text, the children, the title row) and returns a `Drawn`. The editor
 * owns every editable element; the drawing only places them.
 */
import type { LineEnding } from '../core/lines';
import type { NodeView } from '../core/node-views';
import type { PresentationMode } from '../presentation-mode';
import type { Block } from './doc-view';
import type { BlockView } from './block-view';
import type { BlockType, Editor } from './plugin-unit';

// ── Public API ───────────────────────────────────────────────────────────────

/** What every drawing gets. */
export interface DrawContext {
	readonly editor: Editor;
	readonly mode: PresentationMode;
	readonly theme: string;
	/** The caret is in the block. */
	readonly focused: boolean;
	/** Fills `el` with what `produce` makes, cached per block bytes and theme; a throw or a rejection
	 *  shows the block's source with the error instead. */
	render(el: HTMLElement, produce: (theme: string) => Node | Promise<Node>): void;
	/** Read the scroll position before your drawing changes height on its own (an expander's
	 *  click); await the returned restore once it has. Around `update` the editor does it for you. */
	keepScroll(): () => Promise<void>;
}

/** The context of a block with text: `source` is the editor's own element for it, to place in your
 *  drawing (the editor fills it, so put nothing inside). */
export interface TextDrawContext extends DrawContext {
	readonly source: HTMLElement;
	/** The source as typed and not yet written, while an `edit: 'source'` block is open; else null. */
	readonly typed: string | null;
}

/** The context of a block holding blocks: `children` is the editor's element for them, to place in
 *  your drawing (the editor fills it); `title` is its title row's, or null for one without. */
export interface ContainerDrawContext extends DrawContext {
	readonly children: HTMLElement;
	readonly title: HTMLElement | null;
}

/** The context of a block focused whole (`edit: 'box'`). */
export interface BoxDrawContext extends DrawContext {
	/** Hands the caret to the neighbour past `edge`; `x`, your caret's viewport x, carries on as the
	 *  column an up or down arrow keeps. Without `x` it lands at the neighbour's near end. */
	leave(edge: 'start' | 'end', x?: number): void;
	/** Gives the box whole-block focus back from a surface of your own. An Escape a field of yours
	 *  doesn't `preventDefault` does it for you. */
	focusWhole(): void;
}

/** What a drawing hands back. */
export interface Drawn<D, C extends DrawContext = DrawContext> {
	dom: HTMLElement;
	/** Where a click on a picture of the text lands: an element whose text is the block's text, or a
	 *  point to an offset in that text. */
	caret?: HTMLElement | ((point: { x: number; y: number }) => number);
	/** The bytes, position, mode, theme, focus or typed text changed; false draws it again. */
	update?(block: Block<D>, ctx: C): boolean | void;
	/** Events the editor leaves to the drawing (a drag that pans a diagram). */
	keep?(event: Event): boolean;
	/** A box with an editing surface of its own takes the caret through this. */
	focus?: BoxFocus;
	destroy?(): void;
}

/** The caret entering a box with its own editing surface: at an edge, with the column an up or
 *  down arrow keeps as a viewport x (null on a left or right arrow), or back at an offset it gave.
 *  Plain keys in the surface are its own; a chord still reaches the editor unless `keep` takes it. */
export interface BoxFocus {
	enter(at: { edge: 'start' | 'end'; x: number | null } | { offset: number }): void;
	/** Where its caret is, in an offset of its own; null while the caret is elsewhere. */
	offset(): number | null;
}

// ── Internal ─────────────────────────────────────────────────────────────────

/** How a block draws, as its maker hands it to the editor. */
export interface Drawing {
	/** The block type drawn, read once an editor has named it. */
	type(): BlockType<unknown>;
	readonly edit: 'text' | 'source' | 'box' | 'container';
	readonly singleLine: boolean;
	draw(block: Block<unknown>, ctx: DrawContext): Drawn<unknown, DrawContext>;
	renderSource?(text: string): DocumentFragment;
	reshapeSource?(
		text: string,
		caret: number,
		lineEnding: LineEnding
	): { text: string; caret: number } | null;
	/** The read-only marker shown ahead of a container's first child (a footnote's `[^1]: `). */
	ambientPrefix?(node: NodeView): string;
}

export function drawingOf(view: BlockView): Drawing {
	return (view as unknown as { drawing: Drawing }).drawing;
}

/** Where a drawn block's click lands, for each block element the draw host runs; set by the host. */
export const CARET_AT = Symbol('Drawn.caretAt');

/** A drawn block's `caretTargetAtPoint`: what its drawing's `caret` makes of a point, else the
 *  text's start, so a click on any part of the picture opens the text. */
export function drawnCaretAt(
	blockEl: HTMLElement,
	x: number,
	y: number
): { path: number[]; offset: number } {
	const caretAt = (blockEl as { [CARET_AT]?: (x: number, y: number) => number | null })[CARET_AT];
	return { path: [], offset: caretAt?.(x, y) ?? 0 };
}
