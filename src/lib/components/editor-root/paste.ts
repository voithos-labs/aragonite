/**
 * The editor's one paste entry: a paste event anywhere in the root, a menu's Paste and
 * `insertMarkdown` all end here. It makes the one clipboard read, asks where the paste goes (the
 * range the editor holds, the gap caret, the focused block's own answer, or under a block focused
 * whole) and hands both to the range-edit core. A block only says which of its bytes the paste
 * replaces. A text field inside the root, a block with no answer and an event something else
 * already handled keep the browser's paste.
 */

import { claimsBodyChord } from '../../active-editor';
import type { BlockComponent } from '../../block-component';
import { readPasteEvent, scriptedClip, type ClipboardRead } from '../../browser/clipboard';
import type { BlockElLookup } from '../../caret/block-el-lookup';
import { docPathFrom } from '../../core/coordinate-spaces';
import type { DocumentStamps } from '../../editor-actions/commit/document-stamp';
import { emitClipboardError, type EditorEvents } from '../../editor-events';
import type { PasteImageHook } from '../../host-hooks';
import {
	pasteInBlock,
	pasteThroughCore,
	type Clip,
	type PasteContext
} from '../../selection/cross-block/range-paste';
import { findSurfacePathForElement } from '../../selection/path-lookup';
import {
	placeAfterBlock,
	placeBelow,
	placeOfGap,
	type PastePlace
} from '../../selection/range-bytes';
import type { SelectionState } from '../../selection/selection-state.svelte';
import { isWholeBlockInputProxy } from '../../selection/whole-block-input';
import type { SurfacePaste } from '../blocks/editable/surface-clipboard';
import { createImagePasteArm } from '../paste-image-arm';

export interface RootPasteDeps {
	/** A getter, never a value: the root binds after construction. */
	get editorEl(): HTMLElement | undefined;
	selection: Pick<SelectionState, 'ownsRange' | 'gapCaret' | 'widget'>;
	context: PasteContext;
	/** Pastes over the range the editor holds (`CrossBlockHandlers.pasteOverRange`). */
	pasteOverRange(clip: Clip): Promise<boolean>;
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

/** A paste aimed at the place the editor held when it was made; true once bytes moved. */
export type AimedPaste = (clip: Clip) => Promise<boolean>;

export interface RootPaste {
	/** `root` is the element the installing effect captured, not a live binding. */
	onPasteEvent(event: ClipboardEvent, root: HTMLElement): void;
	/** Pastes `clip` where the editor's caret or range is; `below` pastes under the top-level block
	 *  holding the caret. True once bytes moved into the document. */
	paste(clip: Clip, options?: { below?: boolean }): Promise<boolean>;
	/** A paste aimed now, for a caller that waits on something first (a menu's clipboard read);
	 *  null with nowhere to aim. */
	aim(): AimedPaste | null;
}

/** What a block answers `preparePaste` with: the editor's own surface adds its extras. */
type BlockAnswer = Partial<SurfacePaste> | null | undefined;

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

	/** `holder` read into a paste, or null where the editor takes no write. A paste event's block
	 *  is asked `now`, before anything waits; a menu's once its clipboard has arrived. */
	function aimAt(holder: Holder, now: boolean): AimedPaste | null {
		if (!ctx.controller.admitsGesture(null)) return null;
		const madeFor = deps.stamps.current();
		const live = (land: AimedPaste): AimedPaste => {
			return async (clip) => !!clip.text && madeFor.live && (await land(clip)) && madeFor.live;
		};
		switch (holder.at) {
			case 'range':
				return live(deps.pasteOverRange);
			case 'gap': {
				const gap = deps.selection.gapCaret!;
				// Undo puts the caret back on the block beside the gap, the nearest place one can stand.
				const beside = [...gap.parentPath, Math.max(0, gap.index - 1)];
				return live(atPlace(() => placeOfGap(ctx.bytes, gap), beside));
			}
			case 'whole':
				return live(atPlace(() => placeAfterBlock(ctx.bytes, holder.path), holder.path));
			case 'block': {
				const { path, block } = holder;
				const ask = () => block.preparePaste?.() as BlockAnswer;
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

	/** A paste at a place between blocks, whose undo puts the caret back on the block at `beside`. */
	function atPlace(place: () => PastePlace | null, beside: number[]): AimedPaste {
		const undo = { path: docPathFrom(beside), offset: 0 };
		return async (clip) => {
			const at = place();
			return at ? pasteThroughCore(ctx, at, clip, undo) : false;
		};
	}

	/** The paste over the bytes `answer` names, once the block's view is ready for the write. */
	async function intoBlock(
		path: number[],
		block: BlockComponent,
		answer: BlockAnswer,
		clip: Clip
	): Promise<boolean> {
		if (!answer || answer.start === undefined || answer.end === undefined) return false;
		const { start, end } = answer;
		try {
			await answer.settled;
			// A paste that outlived its block (an unmount while its source hid) has nowhere to land.
			if (deps.getBlockComponent(path) !== block) return false;
			// A draft takes the text as written; the document changes when its source hides.
			if (answer.draft) return (answer.draft(clip.text), false);
			const undo = { path: docPathFrom(path), offset: answer.caretBefore ?? start };
			ctx.controller.flushDebouncedCheckpoint();
			return await pasteInBlock(ctx, { path, start, end }, clip, undo, answer.spend);
		} finally {
			ctx.controller.flushDebouncedCheckpoint();
			answer.finish?.(true);
		}
	}

	/** Images go to the host's import first, and what it answers is pasted as Markdown where the
	 *  paste was aimed as the event arrived. */
	async function pasteRead(aimed: AimedPaste, clip: ClipboardRead): Promise<void> {
		const images = imageArm.filesOf(clip.files);
		if (images.length === 0) return void (await aimed(clip));
		const markdown = await imageArm.run(images);
		if ((await aimed(scriptedClip(markdown))) || !markdown) return;
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
			if (!options?.below) {
				const holder = holderAt(active);
				return (holder && aimAt(holder, true)?.(clip)) ?? Promise.resolve(false);
			}
			const block = blockAt(active);
			const lands = block?.at === 'block' && !!clip.text && ctx.controller.admitsGesture(null);
			if (!lands) return Promise.resolve(false);
			const top = [block.path[0]];
			return atPlace(() => placeBelow(ctx.bytes, top), top)(clip);
		},
		aim() {
			const holder = holderAt(document.activeElement);
			return holder && aimAt(holder, false);
		}
	};
}
