/** The keydown and compositionstart half of cross-block dispatch. */

import { CURSOR_START } from '../../block-component';
import type { CrossBlockDispatchContext } from './dispatch';
import type { CstNode, Document } from '../../core/nodes';
import { docPathFrom } from '../../cursor/coordinate-spaces';
import { kindOfPath, replaceRange } from './range-replace';
import { bindsIndentAt, coversIndentBinding, indentRange, INDENT_COMMANDS } from './range-indent';
import { coverRange, rangeCoverage } from '../range-coverage';
import type { SelectionState } from '../selection-state.svelte';
import { blockNodeAt } from '../../tree-operations/node-primitives';
import { isReadingMode } from '../../presentation-mode';
import { eventToChord, isSelectAllChord } from '../../schema/keybindings';
import { dispatchKeyCommand, type CommandDispatchContext } from '../../schema/block-commands';
import { chordsBoundTo, commandForKey } from '../../schema/commands';
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
	handleCompositionEnd(): void;
}

export function createCrossBlockKeydown(ctx: CrossBlockDispatchContext): CrossBlockKeydown {
	return {
		handleKeyDown: (e) => handleKeyDown(ctx, e),
		handleCompositionStart: () => handleCompositionStart(ctx),
		// The composition's own write is done, so a later write never joins its removal.
		handleCompositionEnd: () => ctx.controller.endContinuedBurst()
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

	// The doc-edge extend behaves the same from a caret and from a range, so it runs before the split.
	if (isDocEdgeExtendKey(e)) {
		return handleDocEdgeExtend(ctx, e, e.key === 'End' ? 'end' : 'start');
	}

	if (selection.isCrossBlock) {
		const handled = await handleCrossBlockActive(ctx, e);
		if (handled) return true;
	} else if (takesIdleTab(ctx, e)) {
		e.preventDefault();
		return true;
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
	// Ctrl+C and Ctrl+X have no role: the copy and cut events write the clipboard synchronously,
	// and Tauri's webview refuses `navigator.clipboard.writeText`.
	const role = rangeKeyRole(e, ctx);
	if (role === null) return false;
	e.preventDefault();
	const doc = ctx.getDoc();

	// Reading mode consumes every key that writes, and still extends, collapses and selects all.
	switch (role) {
		case 'delete':
			if (!isReadingMode(ctx.reading.mode)) {
				await replaceRange(ctx, { kind: 'none', gesture: e.key as 'Backspace' | 'Delete' });
			}
			return true;
		case 'rewrite':
			if (!isReadingMode(ctx.reading.mode)) await dispatchOverRange(ctx, e, ctx.getMyPath());
			return true;
		case 'indent':
			if (!isReadingMode(ctx.reading.mode)) await indentRange(ctx, e);
			return true;
		case 'command': {
			const chord = eventToChord(e);
			if (chord && !isReadingMode(ctx.reading.mode)) {
				await replaceRange(ctx, { kind: 'command', chord });
			}
			return true;
		}
		case 'extend':
			extendOverRange(ctx, e, el, doc);
			await revealActiveEndpoint(ctx);
			return true;
		case 'collapse': {
			const toEnd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
			await collapseTo(ctx, toEnd ? 'end' : 'start', doc);
			return true;
		}
		case 'selectAll':
			selectWholeDocument(ctx.selection, doc, ctx.getBlockElByPath);
			return true;
	}
}

/** Shift+Arrow moves the range's focus end. Inside a table it grows the rectangle cell by cell
 *  first, since the generic extend snaps the focus back to the row's first cell. */
function extendOverRange(
	ctx: CrossBlockDispatchContext,
	e: KeyboardEvent,
	el: HTMLElement,
	doc: Document
): void {
	const { selection, getBlockElByPath } = ctx;
	const { grammar } = ctx.reading;
	const key = e.key as ArrowKey;
	const ext = intraTableRectExtension(doc, selection.anchor, selection.focus, key);
	if (ext?.kind === 'cell') {
		selection.extendFocus(cellPoint(selection.focus!.path, ext.offset));
		return;
	}
	if (ext) {
		if (ext.direction === 'forward') {
			extendFocusToNextBlock(selection, doc, grammar, el, ext.fromCellPath, 'vertical');
		} else {
			extendFocusToPreviousBlock(selection, doc, grammar, el, ext.fromCellPath, 'start');
		}
		return;
	}
	const focusPath = selection.focus?.path ?? ctx.getMyPath();
	const focusEl = getBlockElByPath(focusPath) ?? el;
	if (key === 'ArrowDown' || key === 'ArrowRight') {
		const axis = key === 'ArrowDown' ? 'vertical' : 'horizontal';
		extendFocusToNextBlock(selection, doc, grammar, focusEl, focusPath, axis, getBlockElByPath);
	} else {
		const side = key === 'ArrowUp' ? 'start' : 'end';
		extendFocusToPreviousBlock(selection, doc, grammar, focusEl, focusPath, side, getBlockElByPath);
	}
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

/** Tab over a selection inside one block, where neither the block nor one holding it binds the key
 *  to an indent: taken for nothing, as over a range. Reading mode leaves Tab to the next link. */
function takesIdleTab(ctx: CrossBlockDispatchContext, e: KeyboardEvent): boolean {
	if (!isTabKey(e) || isReadingMode(ctx.reading.mode)) return false;
	const el = ctx.getEl();
	const sel = window.getSelection();
	if (!el || !sel || sel.isCollapsed) return false;
	if (!el.contains(sel.anchorNode) || !el.contains(sel.focusNode)) return false;
	const commandOf = (node: CstNode) => commandForKey(e, node.kind, ctx.commands);
	return !bindsIndentAt(ctx.getDoc(), ctx.getMyPath(), commandOf);
}

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
	if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && /^[0-6]$/.test(e.key)) return true;
	return false;
}

/** What reading a key over a live range takes: the range, its document and the keymap. */
export interface RangeKeyReads {
	selection: Pick<SelectionState, 'isCrossBlock' | 'anchor' | 'focus'>;
	getDoc: () => Document;
	commands: Pick<CommandDispatchContext, 'keybindingOverrides' | 'activation'>;
}

/** Every key the range's own handler claims, which a container the key bubbles through must leave
 *  to it: the range's handler awaits before claiming, so the key can reach the container first. */
export function rangeOwnsKey(e: KeyboardEvent, reads: RangeKeyReads): boolean {
	if (!reads.selection.isCrossBlock) return false;
	return isDocEdgeExtendKey(e) || rangeKeyRole(e, reads) !== null;
}

type RangeKeyRole =
	'delete' | 'rewrite' | 'indent' | 'command' | 'extend' | 'collapse' | 'selectAll';

// Each container the key bubbles through asks, and then the range's handler: one answer per event.
const rolesByEvent = new WeakMap<KeyboardEvent, RangeKeyRole | null>();

/** What the range's handler does with a key, or null when it leaves the key to the block. */
function rangeKeyRole(e: KeyboardEvent, reads: RangeKeyReads): RangeKeyRole | null {
	if (rolesByEvent.has(e)) return rolesByEvent.get(e)!;
	const role = readRangeKeyRole(e, reads);
	rolesByEvent.set(e, role);
	return role;
}

function readRangeKeyRole(e: KeyboardEvent, reads: RangeKeyReads): RangeKeyRole | null {
	if (isRangeDeleteKey(e)) return 'delete';
	// Before the command candidates: deleting the range and toggling a format at the collapsed
	// caret would leave empty marker pairs where the text stood.
	if (isClaimedRewriteChord(e)) return 'rewrite';
	if (isIndentKey(e, reads)) return 'indent';
	if (isCommandCandidateKey(e)) return 'command';
	if (e.shiftKey && isArrowKey(e.key)) return 'extend';
	const plain = !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
	if ((e.key === 'Escape' && plain) || (!e.shiftKey && isArrowKey(e.key))) return 'collapse';
	if (isSelectAllChord(e)) return 'selectAll';
	return null;
}

/** Backspace and Delete, which remove the range. */
export function isRangeDeleteKey(e: KeyboardEvent): boolean {
	return e.key === 'Backspace' || e.key === 'Delete';
}

/** Tab and Shift+Tab always, so focus never leaves the editor even when nothing indents; any
 *  other key when a block the range covers binds it to an indent command, as `indentRange` reads it. */
export function isIndentKey(e: KeyboardEvent, reads: RangeKeyReads): boolean {
	if (isTabKey(e)) return true;
	const { anchor, focus } = reads.selection;
	const chord = eventToChord(e);
	// The range is walked only for a chord some keymap binds to indent; any other key costs nothing.
	if (!anchor || !focus || !chord || !chordsBoundTo(INDENT_COMMANDS, reads.commands).has(chord)) {
		return false;
	}
	const doc = reads.getDoc();
	const byKind = new Map<string, AnyCommandId | null>();
	const commandOf = (node: CstNode) => {
		if (!byKind.has(node.kind)) byKind.set(node.kind, commandForKey(e, node.kind, reads.commands));
		return byKind.get(node.kind) ?? null;
	};
	return coversIndentBinding(doc, rangeCoverage(doc, coverRange(doc, anchor, focus)), commandOf);
}

/** Tab or Shift+Tab, with no other modifier. */
function isTabKey(e: KeyboardEvent): boolean {
	return e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey;
}

/** Mod+Shift+End and Mod+Shift+Home, which extend to the document's edge from a caret or a range. */
function isDocEdgeExtendKey(e: KeyboardEvent): boolean {
	return (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'End' || e.key === 'Home');
}

type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

const isArrowKey = (key: string): key is ArrowKey =>
	key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight';

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
