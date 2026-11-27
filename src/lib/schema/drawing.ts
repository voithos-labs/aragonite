/**
 * How a plugin draws a block type: `draw(block, ctx)` builds the block's DOM around the elements the
 * editor hands it (the source text, the children, the title row) and returns a `Drawn`. The editor
 * owns every editable element; the drawing only places them.
 */
import type { LineEnding } from '../core/lines';
import type { NodeView } from '../core/node-views';
import type { Mode } from '../presentation-mode';
import type { Block } from './doc-view';
import type { CodePainter } from './code-highlighter';
import type { BlockView } from './block-view';
import type { BlockType, Editor } from './plugin-unit';
import type { Closable, MarkerHost } from './container-block';
import type { AmbientPrefix, TitleRowLook } from '../block-component';

// ── Public API ───────────────────────────────────────────────────────────────

/** What every drawing gets. */
export interface DrawContext {
	readonly editor: Editor;
	readonly mode: Mode;
	readonly theme: string;
	/** The caret is in the block. */
	readonly focused: boolean;
	/** Your block type's `depends` answer per top-level block, in `editor.doc.blocks`' order,
	 *  never changed after it's handed to you. */
	readonly depends: readonly string[];
	/** Fills `el` with what `produce` makes, cached per theme and block bytes (as typed while its source
	 *  is open); a throw or a rejection shows those bytes with the error instead. */
	render(el: HTMLElement, produce: (theme: string) => Node | Promise<Node>): void;
	/** Read the scroll before your drawing changes height on its own; await the restore once it has.
	 *  The editor does it around `update`, unless the caret is in your text or children as they change. */
	keepScroll(): () => Promise<void>;
	/** Whether `event` on a link your drawing holds follows it, by the host's rule: the click it
	 *  picked for links, or Enter or Space on the focused link. */
	follows(event: MouseEvent | KeyboardEvent): boolean;
}

/** The context of a block with text: `source` is the editor's own element for it, to place in your
 *  drawing (the editor fills it, so put nothing inside). */
export interface TextDrawContext extends DrawContext {
	readonly source: HTMLElement;
	/** The text as typed and not yet written, its marker or fence lines left out as in `block.body`,
	 *  while an `edit: 'source'` block is open; else null. */
	readonly typed: string | null;
}

/** The context of a block holding blocks: `children` is the editor's element for them, to place in
 *  your drawing (the editor fills it), a title row first among them. */
export interface ContainerDrawContext extends DrawContext {
	readonly children: HTMLElement;
	/** The title row's own element, to point at or place a control beside; it stays among the
	 *  children, so never move it. Null with no title row, or while the row is out of the window. */
	readonly title: HTMLElement | null;
	/** Its body is folded away: as its data says, or in reading mode as the reader left it. */
	readonly closed: boolean;
	/** Folds or opens the body: one undo step writing `closable.set`'s data, a caret in the body put
	 *  on the title row; in reading mode only what shows changes. */
	setClosed(closed: boolean): void;
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

/** What a drawing hands back; `H` is what its block type's own commands are handed. */
export interface Drawn<D, C extends DrawContext = DrawContext, H = unknown> {
	dom: HTMLElement;
	/** Where a click on a picture of the text lands: an element whose text is the block's text, or a
	 *  point to an offset in that text. */
	caret?: HTMLElement | ((point: ViewportPoint) => number);
	/** The bytes, position, mode, theme, focus, typed text or `depends` answers changed; false draws
	 *  it again. Without it, what `draw` drew stays. */
	update?(block: Block<D>, ctx: C): boolean | void;
	/** Events the editor leaves to the drawing (a drag that pans a diagram). */
	keep?(event: Event): boolean;
	/** A box with an editing surface of its own takes the caret through this. */
	focus?: BoxFocus;
	/** Commits the text a surface of yours holds unwritten, before it returns; called before an undo,
	 *  a redo or a mode change and as the block leaves the window. A new document drops the text. */
	save?(): void;
	/** Handed to your block type's own commands while the block is drawn (`run`'s third argument). */
	controls?: H;
	destroy?(): void;
}

/** A viewport point a click names, for a drawing that maps it to an offset itself. */
export interface ViewportPoint {
	readonly x: number;
	readonly y: number;
	/** The character offset in `el`'s own text nearest the point, clamped into the box its text
	 *  paints in; null where `el` holds no text. */
	offsetIn(el: HTMLElement): number | null;
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
	depends?(block: Block): string;
	/** Paints the shown text: the editor's markers around the block type's painting of its text. */
	renderSource?(text: string, paint: CodePainter): DocumentFragment;
	/** The shown text inside those markers, which `ctx.typed` hands the drawing. */
	textOf?(shown: string): string;
	/** The block type paints its text itself, so a shown source keeps its own undo steps. */
	paintsText?: boolean;
	reshapeSource?(
		text: string,
		caret: number,
		lineEnding: LineEnding
	): { text: string; caret: number } | null;
	/** The read-only marker shown ahead of a container's first child (a footnote's `[^1]: `). */
	ambientPrefix?(node: NodeView, host: MarkerHost): AmbientPrefix;
	/** A container whose body folds away, as its data says. */
	closable?: Closable<unknown>;
	/** What its title row is called and classed, where several types share the row's kind. */
	titleRow?: TitleRowLook;
}

export function drawingOf(view: BlockView): Drawing {
	return (view as unknown as { drawing: Drawing }).drawing;
}

/** Where a drawn block's click lands, for each block element the draw host runs; set by the host. */
export const CARET_AT = Symbol('Drawn.caretAt');

/** What a drawn block's element hands its type's commands, set by the host: its `Drawn.controls`. */
export const CONTROLS_AT = Symbol('Drawn.controlsAt');

/** The controls the drawing on `blockEl` declares now; undefined with none, or no drawing there. */
export function drawnControlsOf(blockEl: HTMLElement | null): unknown {
	return (blockEl as { [CONTROLS_AT]?: () => unknown } | null)?.[CONTROLS_AT]?.();
}

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
