/** What draws a block kind, opaque here so this module's types name no UI framework. Only a
 *  function that builds a view brands one, and registration refuses anything unbranded. */

import type { AmbientPrefix, BlockComponent } from '../block-component';
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

/** How a view draws: a Svelte component BlockHost renders inline, a DOM spec its host mounts, or a
 *  block type's `draw`, which the editor's draw host runs. */
export type BlockViewForm = 'svelte' | 'dom' | 'drawn';

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

/** The component that hosts a DOM or drawn view, which the view carries so the first load never
 *  holds it. */
export function viewHost(view: BlockView): unknown {
	return (view as unknown as { host: unknown }).host;
}

// ── DOM block views ─────────────────────────────────────────────────────────

/** What the editor builds around a DOM view: nothing, or child blocks. */
export type BlockSurface = BlockViewSpec['surface'];

/**
 * A block drawn into an element the editor makes for it. The view fills `target` itself (classes,
 * children) and never wraps a second box inside, because the editor measures `target` as the
 * block. `surface` says what the editor wires in: nothing, or a container's children.
 */
export type BlockViewSpec = HandBuiltViewSpec | ContainerViewSpec;

interface ViewSpecBase {
	/** Calls `update` on every change to the document, not only to this block. */
	watchDocument?: boolean;
}

/** A block the view draws whole, handing over what the editor calls on it with `ctx.block.publish`. */
export interface HandBuiltViewSpec extends ViewSpecBase {
	surface: 'none';
	mount(target: HTMLElement, ctx: HandBuiltViewContext): BlockViewHandle;
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

export interface ContainerSurface extends CommandHooksSurface {
	/** Mount the child blocks into `box` (`target` or inside it, after the view's children; the box
	 *  they're already in changes nothing); a child's chord resolves against the kind's keymap. */
	mountChildren(box: HTMLElement): void;
	/** Commit a shallow metadata patch as one undo entry, written into the container's bytes. */
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

// ── Where a DOM view's members come from ────────────────────────────────────

/** Who supplies a `BlockComponent` member for a DOM view: what it publishes, its host (from the kind's
 *  registration), the container surface, or nobody outside the editor. */
export type MemberSource = 'view' | 'host' | 'container-surface' | 'editor';

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
	caretBounds: 'editor',
	getCommandContext: 'view',
	isCommandActive: 'view',
	runCommand: 'view',
	editable: 'host',
	preparePaste: 'editor',
	typeText: 'editor',
	afterSourceCommit: 'editor',
	afterSelectionRemoved: 'editor',
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
	claimRootClipboard: 'editor',
	containerChordTarget: 'editor'
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

/** The spec behind a DOM view. */
export function domViewSpec(view: BlockView): BlockViewSpec {
	return (view as unknown as { spec: BlockViewSpec }).spec;
}
