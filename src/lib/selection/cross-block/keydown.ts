/** The keydown and compositionstart half of cross-block dispatch. */

import { CURSOR_START } from '../../block-component';
import type { CrossBlockDispatchContext } from './dispatch';
import type { Document } from '../../core/nodes';
import { docPathFrom } from '../../cursor/coordinate-spaces';
import { kindOfPath, replaceRange } from './range-replace';
import { blockNodeAt } from '../../tree-operations/node-primitives';
import { isReadingMode } from '../../presentation-mode';
import { eventToChord, isSelectAllChord } from '../../schema/keybindings';
import { dispatchKeyCommand } from '../../schema/block-commands';
import { commandForKey } from '../../schema/commands';
import type { AnyCommandId } from '../../schema/command-id';
import {
	collapseCrossBlock,
	extendFocusToNextBlock,
	extendFocusToPreviousBlock,
	extendFocusToDocEdge,
	selectWholeDocument,
	scrollFocusBlockIntoView
} from '../keyboard-extend';
import { pathsEqual } from '../path-math';
import { intraTableRectExtension } from '../table-rect-extend';
import { cellPoint } from '../primitives';
import { applySurfaceContentRange } from '../native-bridge';
import { selectInBlock } from '../caret-doors';

// ── Public API ─────────────────────────────────────────────────────────────

export interface CrossBlockKeydown {
	handleKeyDown(e: KeyboardEvent): Promise<boolean>;
	handleCompositionStart(): boolean;
}

export function createCrossBlockKeydown(ctx: CrossBlockDispatchContext): CrossBlockKeydown {
	return {
		handleKeyDown: (e) => handleKeyDown(ctx, e),
		handleCompositionStart: () => handleCompositionStart(ctx)
	};
}

/** What a keypress resolves to at the block at `getMyPath`, or at global scope with none. */
export function commandAtBlock(
	e: KeyboardEvent,
	ctx: Pick<CrossBlockDispatchContext, 'getDoc' | 'getMyPath' | 'commands'>
): AnyCommandId | null {
	const kind = blockNodeAt(ctx.getDoc(), ctx.getMyPath())?.kind ?? null;
	return commandForKey(e, kind, ctx.commands);
}

// ── Keydown ────────────────────────────────────────────────────────────────

async function handleKeyDown(ctx: CrossBlockDispatchContext, e: KeyboardEvent): Promise<boolean> {
	const { selection } = ctx;

	// Before the dispatch, since every branch below can consume the key and the collapse and
	// extend branches commit nothing that would update the caret memory.
	ctx.caretMemory.noteKey(e, commandAtBlock(e, ctx));

	// Mode-independent: the doc-edge extend behaves identically from a caret and an active range,
	// so it dispatches once, ahead of the mode split.
	if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'End' || e.key === 'Home')) {
		return handleDocEdgeExtend(ctx, e, e.key === 'End' ? 'end' : 'start');
	}

	if (selection.isCrossBlock) {
		const handled = await handleCrossBlockActive(ctx, e);
		if (handled) return true;
	}

	return handleCrossBlockEntry(ctx, e);
}

/** Keystroke dispatch while cross-block mode is already active. */
async function handleCrossBlockActive(
	ctx: CrossBlockDispatchContext,
	e: KeyboardEvent
): Promise<boolean> {
	const el = ctx.getEl();
	if (!el) return false;
	const { selection, getDoc, getBlockElByPath } = ctx;
	const myPath = ctx.getMyPath();
	const doc = getDoc();

	// Ctrl+C and Ctrl+X pass through to the copy and cut events, which write the clipboard
	// synchronously; Tauri's webview refuses `navigator.clipboard.writeText`.

	// Extend, collapse and copy stay live in reading mode. Each reading-mode check below goes once
	// one check in front of every key handler refuses the key first; until then the key is quiet.
	if (e.key === 'Backspace' || e.key === 'Delete') {
		e.preventDefault();
		if (isReadingMode(ctx.reading.mode)) return true;
		await replaceRange(ctx, { kind: 'none', gesture: e.key });
		return true;
	}

	// Before the command candidates: deleting the range and toggling a format at the collapsed
	// caret would leave empty marker pairs where the text stood.
	if (isClaimedRewriteChord(e)) {
		e.preventDefault();
		if (isReadingMode(ctx.reading.mode)) return true;
		await dispatchOverRange(ctx, e, myPath);
		return true;
	}

	if (isCommandCandidateKey(e)) {
		e.preventDefault();
		if (isReadingMode(ctx.reading.mode)) return true;
		const chord = eventToChord(e);
		if (chord) await replaceRange(ctx, { kind: 'command', chord });
		return true;
	}

	// Intra-table rectangle: Shift+Arrow grows the rect cell-by-cell and exits at the vertical
	// edge. Must precede the generic extend, which snaps the focus back to cellIdx 0.
	if (
		e.shiftKey &&
		(e.key === 'ArrowUp' ||
			e.key === 'ArrowDown' ||
			e.key === 'ArrowLeft' ||
			e.key === 'ArrowRight')
	) {
		const ext = intraTableRectExtension(doc, selection.anchor, selection.focus, e.key);
		if (ext) {
			e.preventDefault();
			if (ext.kind === 'cell') {
				selection.extendFocus(cellPoint(selection.focus!.path, ext.offset));
			} else if (ext.direction === 'forward') {
				extendFocusToNextBlock(
					selection,
					doc,
					ctx.reading.grammar,
					el,
					ext.fromCellPath,
					'vertical'
				);
			} else {
				extendFocusToPreviousBlock(
					selection,
					doc,
					ctx.reading.grammar,
					el,
					ext.fromCellPath,
					'start'
				);
			}
			await revealActiveEndpoint(ctx);
			return true;
		}
	}

	if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowRight')) {
		e.preventDefault();
		const focusPath = selection.focus?.path ?? myPath;
		const focusEl = getBlockElByPath(focusPath) ?? el;
		const axis = e.key === 'ArrowDown' ? ('vertical' as const) : ('horizontal' as const);
		extendFocusToNextBlock(
			selection,
			doc,
			ctx.reading.grammar,
			focusEl,
			focusPath,
			axis,
			getBlockElByPath
		);
		await revealActiveEndpoint(ctx);
		return true;
	}
	if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowLeft')) {
		e.preventDefault();
		const focusPath = selection.focus?.path ?? myPath;
		const focusEl = getBlockElByPath(focusPath) ?? el;
		const side = e.key === 'ArrowUp' ? ('start' as const) : ('end' as const);
		extendFocusToPreviousBlock(
			selection,
			doc,
			ctx.reading.grammar,
			focusEl,
			focusPath,
			side,
			getBlockElByPath
		);
		await revealActiveEndpoint(ctx);
		return true;
	}

	if (e.key === 'Escape' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
		e.preventDefault();
		await collapseTo(ctx, 'start', doc);
		return true;
	}

	if (!e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) {
		e.preventDefault();
		await collapseTo(ctx, 'start', doc);
		return true;
	}
	if (!e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) {
		e.preventDefault();
		await collapseTo(ctx, 'end', doc);
		return true;
	}

	if (isSelectAllChord(e)) {
		e.preventDefault();
		selectWholeDocument(selection, doc, getBlockElByPath);
		return true;
	}

	return false;
}

/** The entry branch: chords that start a selection from a collapsed caret. */
async function handleCrossBlockEntry(
	ctx: CrossBlockDispatchContext,
	e: KeyboardEvent
): Promise<boolean> {
	const el = ctx.getEl();
	if (!el) return false;
	const { selection, getDoc } = ctx;

	if (isSelectAllChord(e)) {
		e.preventDefault();
		// Ended before the count moves, since ending a selected widget restarts the run.
		const first = selection.selectAllCount === 0;
		selection.batch(() => {
			if (first) selectInBlock(selection, () => applySurfaceContentRange(el));
			selection.incrementSelectAllCount();
		});
		if (!first) selectWholeDocument(selection, getDoc(), ctx.getBlockElByPath);
		return true;
	}

	return false;
}

// ── Keydown Helpers ───────────────────────────────────────────────────────

/** Resolves a swallowed format chord against the kind of the block that took the key, as a
 *  single-block keystroke would, so a consumer's rebinding reaches the same handler. */
async function dispatchOverRange(
	ctx: CrossBlockDispatchContext,
	e: KeyboardEvent,
	path: number[]
): Promise<void> {
	const chord = eventToChord(e);
	if (!chord) return;
	const surface = await ctx.caretLanding.mount(path);
	dispatchKeyCommand(
		chord,
		// The block may have no `runCommand` of its own; the range's handler is reached in the
		// dispatcher ahead of any per-block `runCommand`, so an absent one is not a decline.
		{
			kind: kindOfPath(path, ctx.getDoc()),
			runCommand: (id, arg) => surface?.runCommand?.(id, arg) ?? false,
			getPath: () => path
		},
		ctx.commands
	);
}

/** Keys the block-level handler owns, which must run at a collapsed caret rather than over stale
 *  block indices, so they dispatch after the range is removed. */
export function isCommandCandidateKey(e: KeyboardEvent): boolean {
	if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) return true;
	if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) return true;
	if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && /^[0-6]$/.test(e.key)) return true;
	return false;
}

/** Chords the range handles itself, swallowed before the browser's bold or Ctrl+K kill-line runs.
 *  Mod+Shift+X is here on its own, since unshifted Mod+X is the block cut. */
export function isClaimedRewriteChord(e: KeyboardEvent): boolean {
	if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
	// Literal comparisons, not a character class: the chord scan reads the keys a file compares,
	// and a regex would hide this file's use of Mod+B/I/E/K from it (G4.29).
	if (e.shiftKey) return e.key === 'x' || e.key === 'X';
	return (
		e.key === 'b' ||
		e.key === 'B' ||
		e.key === 'i' ||
		e.key === 'I' ||
		e.key === 'e' ||
		e.key === 'E' ||
		e.key === 'k' ||
		e.key === 'K'
	);
}

/** Corrects the side the arrow key recorded: the caret jumped to the range's edge, where the side
 *  depends on the construct there (`docs/design/live-mode.md` § 4.2 Typing at a hidden edge). */
async function collapseTo(
	ctx: CrossBlockDispatchContext,
	to: 'start' | 'end',
	doc: Document
): Promise<void> {
	await collapseCrossBlock(ctx.selection, to, doc, ctx.caretLanding.restore);
	// After the restore, which forgets how the caret arrived.
	ctx.caretMemory.noteExtreme();
}

/** Parks the caret at the focus endpoint, never ending the range (G2.12) and never opening a
 *  closed body. A cell takes its start, since ArrowRight at its end reads as leaving the table. */
async function revealActiveEndpoint(ctx: CrossBlockDispatchContext): Promise<void> {
	const focus = ctx.selection.focus;
	const landing = focus && ctx.selection.cellLandingFor(focus);
	// A landing that deepened the path is a cell; anything else lands as itself. A cell that never
	// mounted falls through, so the mounted table still scrolls the endpoint into view.
	if (focus && landing && !pathsEqual(landing.path, focus.path)) {
		if (await ctx.caretLanding.park({ path: docPathFrom(landing.path), offset: CURSOR_START })) {
			return;
		}
	}
	// A windowed-out text endpoint cannot be scrolled to while unmounted, so it mounts first.
	if (focus && !ctx.getBlockElByPath(focus.path)) {
		await ctx.caretLanding.park({ path: docPathFrom(focus.path), offset: focus.offset });
	}
	scrollFocusBlockIntoView(ctx.selection, ctx.scrollOwner);
}

async function handleDocEdgeExtend(
	ctx: CrossBlockDispatchContext,
	e: KeyboardEvent,
	direction: 'start' | 'end'
): Promise<boolean> {
	const el = ctx.getEl();
	if (!el) return false;
	e.preventDefault();
	extendFocusToDocEdge(
		ctx.selection,
		ctx.getDoc(),
		ctx.reading.grammar,
		el,
		ctx.getMyPath(),
		direction,
		ctx.getBlockElByPath
	);
	await revealActiveEndpoint(ctx);
	return true;
}

// ── CompositionStart ───────────────────────────────────────────────────────

/** Unawaited: the removal commits before the replace's first await, so the range is gone before
 *  the IME writes, and the composed text joins its undo entry. */
function handleCompositionStart(ctx: CrossBlockDispatchContext): boolean {
	ctx.caretMemory.forget();
	if (!ctx.selection.isCrossBlock) return false;
	void replaceRange(ctx, { kind: 'composition' });
	return true;
}
