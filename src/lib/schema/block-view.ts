/** What draws a block kind, opaque here so this module's types name no UI framework. Only a
 *  function that builds a view brands one, and registration refuses anything unbranded. */

import type { AmbientPrefix, BlockComponent } from '../block-component';
import type { LineEnding } from '../core/lines';
import type { NodeView } from '../core/node-views';
import type { PresentationMode } from '../presentation-mode';
import type { BlockCommandContext } from './block-commands';
import type { Draft, DraftSpec } from './drafts';
import type { EditorContext } from './plugin-install';

const blockViewBrand: unique symbol = Symbol('BlockView');
const viewForm = Symbol('BlockView.form');

/** What draws a block kind: `defineBlockView`, `textBlockView` or `svelteBlockView` (from
 *  `@voithos-labs/aragonite/svelte`) makes one. */
export interface BlockView {
	readonly [blockViewBrand]: true;
}

/** How a view draws: a Svelte component BlockHost renders inline, or a DOM spec its host mounts. */
export type BlockViewForm = 'svelte' | 'dom';

/** Marks `body` as a block view of `form`; only the functions that build a view call it. */
export function asBlockView<T extends object>(body: T, form: BlockViewForm): T & BlockView {
	return Object.assign(body, { [blockViewBrand]: true as const, [viewForm]: form });
}

export function isBlockView(value: unknown): value is BlockView {
	return (value as Partial<BlockView> | undefined)?.[blockViewBrand] === true;
}

export function blockViewForm(view: BlockView): BlockViewForm {
	return (view as unknown as Record<typeof viewForm, BlockViewForm>)[viewForm];
}

// ── DOM block views ─────────────────────────────────────────────────────────

/** What the editor builds around a DOM view: nothing, an editable text leaf (shown always, or
 *  behind a rendered view until a click), or child blocks. */
export type BlockSurface = BlockViewSpec['surface'];

/**
 * A block drawn into an element the editor makes for it. The view fills `target` itself (classes,
 * children) and never wraps a second box inside, because the editor measures `target` as the
 * block. `surface` says what the editor wires in: a leaf's editable text, a container's children.
 */
export type BlockViewSpec =
	HandBuiltViewSpec | LeafViewSpec | RenderPrimaryViewSpec | ContainerViewSpec;

interface ViewSpecBase {
	/** Calls `update` on every change to the document, not only to this block. */
	watchDocument?: boolean;
}

/** A block the view draws whole, handing over what the editor calls on it with `ctx.block.publish`. */
export interface HandBuiltViewSpec extends ViewSpecBase {
	surface: 'none';
	mount(target: HTMLElement, ctx: HandBuiltViewContext): BlockViewHandle;
}

/** A block whose text the editor edits, in the element the view hands to `ctx.leaf.attach`. */
export interface LeafViewSpec extends ViewSpecBase {
	surface: 'leaf';
	/** The kind's bytes are one line: Enter splits the block rather than typing a newline. */
	singleLine?: boolean;
	mount(target: HTMLElement, ctx: LeafViewContext): LeafViewHandle;
}

/**
 * A block that shows a rendered view until a click opens its text, block math's shape. The view
 * swaps its halves on `state.revealed` and commits nothing itself: the shown text is written as
 * one undo entry when focus leaves it.
 */
export interface RenderPrimaryViewSpec extends ViewSpecBase {
	surface: 'render-primary';
	/** The kind's bytes are one line: Enter splits the block rather than typing a newline. */
	singleLine?: boolean;
	/** Draws the shown text as DOM (hidden fence lines, highlight tokens); must keep
	 *  `fragment.textContent === text`, or caret offsets drift. */
	renderSource?(text: string): DocumentFragment;
	/** The text as the kind keeps it, asked on show and after every edit, with the caret carried;
	 *  an added line takes `lineEnding`. Null keeps it. */
	reshapeSource?(
		text: string,
		caret: number,
		lineEnding: LineEnding
	): { text: string; caret: number } | null;
	mount(target: HTMLElement, ctx: RenderPrimaryViewContext): LeafViewHandle;
}

/** A block holding child blocks, which the editor mounts into the box the view names; or, for a
 *  kind declaring `blockFocus: 'whole-block'`, none, with an editing surface of the view's own. */
export interface ContainerViewSpec extends ViewSpecBase {
	surface: 'container';
	/** The read-only marker drawn before the first child's text, like a footnote's `[^1]: `. Read
	 *  live, so a marker taken from the node follows an edit. */
	ambientPrefix?(state: BlockViewState, editor: EditorContext): AmbientPrefix;
	mount(target: HTMLElement, ctx: ContainerViewContext): BlockViewHandle;
}

/** The block as `update` sees it; `node` is read-only, and edits go through the surface. */
export interface BlockViewState {
	node: NodeView;
	path: readonly number[];
	presentationMode: PresentationMode;
	theme: string;
	/** A render-primary block's text is showing; false on every other surface. */
	revealed: boolean;
}

export interface BlockViewContext {
	/** The current state, read at call time. */
	state(): BlockViewState;
	/** The context of the editor drawing this block, for the plugin that owns its kind. */
	readonly editor: EditorContext;
}

export interface HandBuiltViewContext extends BlockViewContext {
	readonly block: HandBuiltSurface;
}

export interface LeafViewContext extends BlockViewContext {
	readonly leaf: LeafSurface;
}

export interface RenderPrimaryViewContext extends BlockViewContext {
	readonly leaf: RenderPrimarySurface;
}

export interface ContainerViewContext extends BlockViewContext {
	readonly container: ContainerSurface;
}

export interface CommandHooksSurface {
	/** What a block command running on this block gets as `ctx.hooks` (opening the view's own
	 *  editor, say); the last value set wins, and a view that never sets one hands `undefined`. */
	setCommandHooks(hooks: BlockCommandContext['hooks']): void;
}

export interface HandBuiltSurface {
	/** What the editor calls on the block from now on, replacing the last. Before the first call
	 *  and after `null`, the block publishes nothing: it takes no focus, and arrows pass over it. */
	publish(block: HandBuiltBlock | null): void;
}

export interface LeafSurface extends CommandHooksSurface {
	/** The element inside `target` the editor edits the block's text in, holding no element of
	 *  the view's own (chrome goes beside it); null hands it back empty. */
	attach(el: HTMLElement | null): void;
	/** Focus the text with the caret at `offset`. */
	reveal(offset?: number): Promise<void>;
	/** Replace the block's text as one undo entry. */
	commitSource(text: string): void;
}

/** A render-primary leaf: call `attach` from inside the `update` that reveals, so the caret lands
 *  with the render, and `attach(null)` when it folds. */
export interface RenderPrimarySurface extends LeafSurface {
	/** The rendered half, `target` or inside it: a click there opens the text where the kind's
	 *  `caretTargetAtPoint` says, and a chord pressed there runs at this block. */
	attachRendered(el: HTMLElement | null): void;
}

export interface ContainerSurface extends CommandHooksSurface {
	/** Mount the child blocks into `box` (`target` or inside it, after the view's children; the box
	 *  they're already in changes nothing); a child's chord resolves against the kind's keymap. */
	mountChildren(box: HTMLElement): void;
	/** Commit a shallow metadata patch as one undo entry, through the kind's `rebuildRaw`. */
	updateOwnMetadata(
		patch: Record<string, unknown>,
		options?: { caret?: { path: number[]; offset: number } }
	): void | Promise<void>;
	/** Hand the caret to the neighbour a plain arrow points at; false for any other key. */
	moveFocusOut(e: KeyboardEvent): boolean;
	/** Read the scroll position before a change of height; await the restore after it renders. */
	captureScrollPosition(): () => Promise<void>;
	openDraft(spec: DraftSpec): Draft;
	/** The element focus goes to while a `blockFocus: 'whole-block'` kind is focused whole (any other
	 *  kind throws), `target` or inside it, for every state the view shows; null while none shows. */
	attachFocus(el: HTMLElement | null): void;
}

export interface BlockViewHandle {
	/** The block's state changed. Returning false destroys the view and mounts it again. */
	update?(state: BlockViewState): boolean | void;
	/** A promise it returns (a framework's unmount) is watched for a rejection. */
	destroy?(): void | Promise<void>;
}

export interface LeafViewHandle extends BlockViewHandle {
	/** After each change to the attached element's text (typing, a delete, a paste, an IME
	 *  commit, an undo), once, with that text; never mid-composition. A throw is reported on `error`. */
	afterInput?(text: string): void;
}

// ── Where a DOM view's members come from ────────────────────────────────────

/** Who supplies a `BlockComponent` member for a DOM view: what it publishes, its host (from the kind's
 *  registration), the leaf or container surface, or nobody outside the editor. */
export type MemberSource = 'view' | 'host' | 'leaf-surface' | 'container-surface' | 'editor';

/** G3.18: every `BlockComponent` member has a source, so a new member fails `npm run check`
 *  until it's given one. */
export const MEMBER_SOURCES = {
	focus: 'view',
	getCursorOffset: 'view',
	focusable: 'view',
	parkCaret: 'view',
	focusAtColumn: 'view',
	getSelectedText: 'view',
	setSelection: 'view',
	measurePartialRects: 'view',
	getCommandContext: 'view',
	isCommandActive: 'view',
	runCommand: 'view',
	editable: 'host',
	insertMarkdown: 'leaf-surface',
	insertPlainText: 'leaf-surface',
	typeText: 'leaf-surface',
	afterSourceCommit: 'leaf-surface',
	afterSelectionRemoved: 'leaf-surface',
	childList: 'container-surface',
	focusByPath: 'container-surface',
	getCursorPosition: 'container-surface',
	enterEdgeWidget: 'container-surface',
	isVerticallyTransparent: 'container-surface',
	readSnapAtPoint: 'editor',
	startDragAtPoint: 'editor',
	cellRect: 'editor',
	mountedRowWindow: 'editor',
	getSelectionOffsets: 'editor',
	applyMenuClipboard: 'editor',
	claimRootClipboard: 'editor'
} as const satisfies Record<keyof BlockComponent, MemberSource>;

type HandBuiltMember = {
	[K in keyof typeof MEMBER_SOURCES]: (typeof MEMBER_SOURCES)[K] extends 'view' ? K : never;
}[keyof typeof MEMBER_SOURCES];

/** The members a hand-built view may publish, read off `MEMBER_SOURCES`. */
export const HAND_BUILT_MEMBERS = (
	Object.keys(MEMBER_SOURCES) as (keyof typeof MEMBER_SOURCES)[]
).filter((key): key is HandBuiltMember => MEMBER_SOURCES[key] === 'view');

/** What the editor calls on a hand-built block; `editable` comes from the kind's registration. */
export type HandBuiltBlock = Pick<BlockComponent, HandBuiltMember>;

const SURFACES: readonly BlockSurface[] = ['none', 'leaf', 'render-primary', 'container'];

/** A block view drawn by `spec`. Throws on a `surface` or `mount` it can't use. */
export function defineBlockView(spec: BlockViewSpec): BlockView {
	if (!SURFACES.includes(spec?.surface)) {
		throw new TypeError(
			`defineBlockView: \`surface\` must be one of ${SURFACES.map((s) => `'${s}'`).join(', ')}`
		);
	}
	if (typeof spec.mount !== 'function') {
		throw new TypeError('defineBlockView: `mount` must be a function');
	}
	return asBlockView({ spec: { ...spec } as BlockViewSpec }, 'dom');
}

/** The spec behind a DOM view. */
export function domViewSpec(view: BlockView): BlockViewSpec {
	return (view as unknown as { spec: BlockViewSpec }).spec;
}
