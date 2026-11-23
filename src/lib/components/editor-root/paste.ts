/**
 * The editor's one paste entry: a paste event anywhere in the root, a menu's Paste and
 * `insertMarkdown` all end here. It makes the one clipboard read, asks where the paste goes (the
 * range the editor holds, the gap caret, the focused block's own answer, or under a block focused
 * whole) and hands both to the range-edit core. A block only says which of its bytes the paste
 * replaces. A text field inside the root, a block with no answer and an event something else
 * already handled keep the browser's paste.
 */

import { claimsBodyChord } from '../../active-editor';
import type { BlockComponent, PreparedPaste } from '../../block-component';
import { readPasteEvent, scriptedClip, type ClipboardRead } from '../../browser/clipboard';
import type { BlockElLookup } from '../../caret/block-el-lookup';
import { docPathFrom } from '../../core/coordinate-spaces';
import { isBlankText } from '../../core/lines';
import type { DocumentStamps } from '../../editor-actions/commit/document-stamp';
import { emitClipboardError, type EditorEvents } from '../../editor-events';
import type { PasteImageHook } from '../../host-hooks';
import {
	pasteInBlock,
	pasteThroughCore,
	type PasteContext
} from '../../selection/cross-block/range-paste';
import { findSurfacePathForElement } from '../../selection/path-lookup';
import { placeAfterBlock, placeOfGap, type PasteAim } from '../../selection/range-bytes';
import type { SelectionState } from '../../selection/selection-state.svelte';
import { isWholeBlockInputProxy } from '../../selection/whole-block-input';
import { blockNodeAt } from '../../tree-operations/node-primitives';
import { blockFacts, holdsLiteralBody } from '../../schema/block-facts';
import { createImagePasteArm } from '../paste-image-arm';
import {
	wholeRewritten,
	type PastedClip,
	type RewrittenClip
} from '../../tree-operations/paste/paste-rewrites';

export interface RootPasteDeps {
	/** A getter, never a value: the root binds after construction. */
	get editorEl(): HTMLElement | undefined;
	selection: Pick<SelectionState, 'ownsRange' | 'gapCaret' | 'widget'>;
	/** What the paste reads and commits through; its controller is the editor's own. */
	context: PasteContext;
	/** Pastes over the range the editor holds (`CrossBlockHandlers.pasteOverRange`). */
	pasteOverRange(clip: RewrittenClip): Promise<boolean>;
	/** Makes an empty top-level paragraph at `boundary`. */
	insertParagraph(boundary: number, text: string): Promise<boolean>;
	getBlockComponent(path: number[]): BlockComponent | null;
	getBlockElByPath: BlockElLookup;
	/** Whether the paste event arriving now came of the plain-paste chord. */
	plainPaste(): boolean;
	onPasteImage: () => PasteImageHook | undefined;
	events: EditorEvents;
	/** Whether `node` is in the host's header, whose fields keep their own clipboard. */
	isHostChrome(node: Node | null): boolean;
	stamps: Pick<DocumentStamps, 'current'>;
}

/** A paste aimed at the place the editor held when it was made; true once it was taken: bytes
 *  moved into the document, or a shown source drafted them. */
export type AimedPaste = (clip: PastedClip) => Promise<boolean>;

export interface RootPaste {
	/** `root` is the element the installing effect captured, not a live binding. */
	onPasteEvent(event: ClipboardEvent, root: HTMLElement): void;
	/** Pastes `clip` at the editor's caret or range; `below` makes it a block of its own (see
	 *  `onEmptyParagraph`). True as an `AimedPaste` is. */
	paste(clip: PastedClip, options?: { below?: boolean }): Promise<boolean>;
	/** A paste aimed now, for a caller that waits on something first (a menu's clipboard read);
	 *  null with nowhere to aim. */
	aim(): AimedPaste | null;
}

/** An aimed paste past the whole-paste rewrites, which have read its clip. */
type Landing = (clip: RewrittenClip) => Promise<boolean>;

/** Where a paste goes, before the block is asked anything. */
type Holder =
	| { at: 'range' }
	| { at: 'gap' }
	| { at: 'block'; path: number[]; block: BlockComponent }
	| { at: 'whole'; path: number[] };

const EDITING_HOST = '[contenteditable]:not([contenteditable="false"])';

export function createRootPaste(deps: RootPasteDeps): RootPaste {
	const { context: ctx } = deps;
	const imageArm = createImagePasteArm(deps);

	/** The block whose text `el` sits in, or the block `el` stands in for whole. */
	function blockAt(el: Element | null): Extract<Holder, { path: number[] }> | null {
		const inRoot = el !== null && !!deps.editorEl?.contains(el);
		const path =
			deps.selection.widget?.paragraphPath ?? (inRoot ? findSurfacePathForElement(el) : null);
		const block = path && deps.getBlockComponent(path);
		if (!path || !block) return null;
		if (block.preparePaste) return { at: 'block', path, block };
		return isWholeBlockInputProxy(el) ? { at: 'whole', path } : null;
	}

	/** Whether the block at `el` is a paragraph with no text: an empty line, item or to-do, which a
	 *  block of its own takes the place of. */
	function onEmptyParagraph(el: Element | null): boolean {
		const block = blockAt(el);
		const node = block && blockNodeAt(ctx.getDoc(), block.path);
		return node?.kind === 'paragraph' && isBlankText(node.raw);
	}

	/** The place the editor holds: its range, its gap caret, else the block at `el`, the focused
	 *  element or a paste event's target. */
	function holderAt(el: Element | null): Holder | null {
		if (deps.selection.ownsRange) return { at: 'range' };
		return deps.selection.gapCaret ? { at: 'gap' } : blockAt(el);
	}

	/** The place a paste event is for, or null where the event is not the editor's to take. */
	function holderFor(event: ClipboardEvent, root: HTMLElement): Holder | null {
		const { target } = event;
		if (event.defaultPrevented) return null;
		if (target === null || target === root.ownerDocument.body)
			return claimsBodyChord(root) ? holderAt(null) : null;
		if (!(target instanceof Element) || !root.contains(target)) return null;
		if (deps.isHostChrome(target)) return null;
		if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return null;
		const host = target.closest(EDITING_HOST);
		if (!host) return holderAt(null);
		const holder = holderAt(target);
		if (host.closest('[data-gap-caret]') || isWholeBlockInputProxy(host)) return holder;
		// Any other editable element is the editor's own only as a block's text: a plugin's own
		// field, and a block with no answer, keep the browser's paste.
		if (holder?.at !== 'block') return holder?.at === 'range' ? holder : null;
		return deps.getBlockElByPath(holder.path)?.contains(target) ? holder : null;
	}

	/** The clip as the whole-paste rewrites leave it, read before anything reads where it lands. */
	const rewritten = (clip: PastedClip) =>
		wholeRewritten(clip, ctx.activePlugins, ctx.reading.grammar);

	/** The clip as it lands at `holder`: text pasted into a literal body is code, which no whole-paste
	 *  rewrite reads; the core asks the rest only where the paste lands as blocks. */
	function rewrittenAt(holder: Holder, clip: PastedClip): RewrittenClip {
		return holder.at === 'block' && literalAt(holder.path)
			? { ...clip, asksRewrites: 'blocks' }
			: rewritten(clip);
	}

	/** Whether the text block at `path` holds a literal body: a code body, a shown source. */
	function literalAt(path: number[]): boolean {
		const doc = ctx.getDoc();
		const node = blockNodeAt(doc, path);
		const parent = path.length > 1 ? blockNodeAt(doc, path.slice(0, -1)) : null;
		return !!node && holdsLiteralBody(blockFacts, node.kind, parent?.kind);
	}

	/** `holder` read into a paste, or null where the editor takes no write; the whole-paste
	 *  rewrites read the clip before the paste lands. */
	function aimAt(holder: Holder, now: boolean): AimedPaste | null {
		const land = landingAt(holder, now);
		return land && ((clip) => land(rewrittenAt(holder, clip)));
	}

	/** `holder` read into a landing. A paste event's block is asked `now`, before anything waits; a
	 *  menu's once its clipboard has arrived. */
	function landingAt(holder: Holder, now: boolean): Landing | null {
		if (!ctx.controller.admitsGesture(null)) return null;
		const madeFor = deps.stamps.current();
		const live = (land: Landing): Landing => {
			return async (clip) => !!clip.text && madeFor.live && (await land(clip)) && madeFor.live;
		};
		switch (holder.at) {
			case 'range':
				return live(deps.pasteOverRange);
			case 'gap': {
				const gap = deps.selection.gapCaret!;
				// Undo puts the caret back on the block beside the gap, the nearest place one can stand.
				const beside = [...gap.parentPath, Math.max(0, gap.index - 1)];
				const named = [beside, [...gap.parentPath, gap.index]];
				return live(atPlace({ named, place: () => placeOfGap(ctx.bytes, gap) }, beside));
			}
			case 'whole': {
				const { path } = holder;
				return live(
					atPlace({ named: [path], place: () => placeAfterBlock(ctx.bytes, path) }, path)
				);
			}
			case 'block': {
				const { path, block } = holder;
				const ask = () => block.preparePaste?.() ?? null;
				if (!now) return live((clip) => intoBlock(path, block, ask(), clip));
				const answer = ask();
				// Asked, the block holds the caret memory's records until the paste lets them go.
				return async (clip) => {
					const lands = !!clip.text && madeFor.live;
					if (!lands) answer?.finish?.(true);
					return lands && (await intoBlock(path, block, answer, clip)) && madeFor.live;
				};
			}
		}
	}

	/** A paste at a place between blocks, whose undo puts the caret back on the block at `beside`.
	 *  It lands in blocks of its own, so no block's step spends it. */
	function atPlace(aim: PasteAim, beside: number[]): Landing {
		const undo = { path: docPathFrom(beside), offset: 0 };
		return (clip) => pasteThroughCore(ctx, aim, clip, undo, null);
	}

	/** The paste into a paragraph opened under top-level block `top`, both one undo entry: the
	 *  clipboard lands there as on any empty line, so a list beside a list of its type joins it. */
	async function below(top: number, clip: RewrittenClip): Promise<boolean> {
		const madeFor = deps.stamps.current();
		const opened = docPathFrom([top + 1]);
		let landed = false;
		await ctx.controller.undoStep({ path: docPathFrom([top]), offset: 0 }, async () => {
			if (!(await deps.insertParagraph(top + 1, '')) || !madeFor.live) return;
			const at = { path: opened, start: 0, end: 0 };
			// An empty paragraph has no hidden edge for a step to move the text across.
			landed = await pasteInBlock(ctx, at, clip, { path: opened, offset: 0 }, null);
		});
		return landed && madeFor.live;
	}

	/** The paste over the bytes `answer` names, once the block's view is ready for the write. */
	async function intoBlock(
		path: number[],
		block: BlockComponent,
		answer: PreparedPaste | null,
		clip: RewrittenClip
	): Promise<boolean> {
		if (!answer) return false;
		const { start, end } = answer;
		try {
			await answer.settled;
			// A paste that outlived its block (an unmount while its source hid) has nowhere to land.
			if (deps.getBlockComponent(path) !== block) return false;
			// A draft takes the text as written; the document changes when its source hides.
			if (answer.draft) return (answer.draft(clip.text), true);
			const undo = { path: docPathFrom(path), offset: answer.caretBefore ?? start };
			ctx.controller.flushDebouncedCheckpoint();
			return await pasteInBlock(ctx, { path, start, end }, clip, undo, answer.spend ?? null);
		} finally {
			ctx.controller.flushDebouncedCheckpoint();
			answer.finish?.(true);
		}
	}

	/** Images go to the host's import first, and what it answers is pasted as Markdown: over a
	 *  range the editor came to hold meanwhile, else where the paste was aimed as the event arrived. */
	async function pasteRead(aimed: AimedPaste, clip: ClipboardRead): Promise<void> {
		const images = imageArm.filesOf(clip.files);
		if (images.length === 0) return void (await aimed(clip));
		const madeFor = deps.stamps.current();
		const answered = scriptedClip(await imageArm.run(images), true);
		const overRange = madeFor.live && deps.selection.ownsRange;
		const markdown = overRange ? rewrittenAt({ at: 'range' }, answered) : null;
		// The aim is still asked, with nothing, so a block it prepared lets its records go.
		const landed = markdown
			? !(await aimed(scriptedClip('', true))) &&
				!!markdown.text &&
				(await deps.pasteOverRange(markdown))
			: await aimed(answered);
		if (landed || !answered.text) return;
		// The asset is imported and nothing shows it, which only the host can clean up.
		emitClipboardError(deps.events, {
			error: new Error('an imported image had nowhere to land; nothing inserted')
		});
	}

	return {
		onPasteEvent(event, root) {
			const holder = holderFor(event, root);
			if (!holder) return;
			// Before anything waits: the browser's own paste would write DOM the document never sees.
			event.preventDefault();
			const clip = readPasteEvent(event, deps.plainPaste());
			const aimed = aimAt(holder, true);
			if (aimed) void pasteRead(aimed, clip);
		},
		paste(clip, options) {
			const active = document.activeElement;
			const holder = holderAt(active);
			// A place that lands blocks already takes a block of its own as it stands.
			const here = holder?.at === 'gap' || holder?.at === 'whole' || onEmptyParagraph(active);
			if (!options?.below || here)
				return (holder && aimAt(holder, true)?.(clip)) ?? Promise.resolve(false);
			const block = blockAt(active);
			if (block?.at !== 'block' || !clip.text || !ctx.controller.admitsGesture(null))
				return Promise.resolve(false);
			const taken = rewritten(clip);
			return taken.text ? below(block.path[0], taken) : Promise.resolve(false);
		},
		aim() {
			const holder = holderAt(document.activeElement);
			return holder && aimAt(holder, false);
		}
	};
}
