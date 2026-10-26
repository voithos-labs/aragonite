/**
 * Editor-root pointer gestures: clicks in priority order (the link card, link activation, the
 * caret for empty space, a block's own box), the margin drag the browser cannot start from a
 * non-editable element, multi-click selection, and where a right-click leaves the caret.
 */

import type { BlockComponent } from '../../block-component';
import type { CaretMemory } from '../../caret/caret-memory';
import type { CaretWriter } from '../../browser/caret-writer';
import type { CaretLanding } from '../../selection/caret-landing';
import type { UserScrollport } from '../../windowing/scroll-ancestors';
import type { DocumentGetter } from '../../editor-keys';
import type { BlockElLookup } from '../../caret/block-el-lookup';
import { BLOCK_TEXT_SELECTOR } from '../../caret/block-content-selector';
import {
	planPaddingPress,
	rangeCoversPoint,
	resetForPointerDown
} from '../../selection/cross-block/pointer';
import { nativeRangeIn } from '../../browser/selection-read';
import { createDeadSpaceCaret } from '../../selection/dead-space-caret';
import { installDragListener } from '../../selection/drag-pointer';
import { installMultiClickSelect } from '../../selection/multi-click';
import { findSurfacePathForElement } from '../../selection/path-lookup';
import { claimsPointerGesture } from '../../selection/pointer-gesture';
import type { SelectionState } from '../../selection/selection-state.svelte';
import { isBlockNode, nodeAt } from '../../tree-operations/node-primitives';
import { isSecondaryPress, pressesSelectedWidget } from '../../selection/widget-press';
import {
	LINK_ELEMENT_SELECTOR,
	clickFollowsAt,
	resolveLinkAtPoint,
	type LinkPointQuery
} from '../blocks/text/link-at-point';
import { rawOffsetAt } from '../../browser/offsets';
import { onRoot, removeAll } from './listeners';
import type { LinkCardState } from '../link-card/link-card-state.svelte';
import type { Reading } from '../../schema/reading';
import type { ReadingFocus } from './reading-focus.svelte';
import { isModifiedClick, type ActivationClick, type PressTracker } from '../../activation-click';

export interface RootGesturesDeps {
	getDoc: DocumentGetter;
	selection: SelectionState;
	caretWriter: CaretWriter;
	caretMemory: Pick<CaretMemory, 'forget'>;
	getBlockElByPath: BlockElLookup;
	getBlockComponent(path: number[]): BlockComponent | null;
	/** How a click below the last mounted block puts the caret at the document's end. */
	land: CaretLanding['land'];
	getScrollHost(): UserScrollport | null;
	getLifetime(): AbortSignal;
	isHostChrome(node: Node | null): boolean;
	activateLink(href: string, event: MouseEvent): void;
	/** Whether a click on a link follows it rather than placing the caret. */
	activationClick: ActivationClick;
	/** Whether a release travelled from its press, which makes it the end of a drag. */
	presses: Pick<PressTracker, 'travelled'>;
	linkCard: Pick<LinkCardState, 'open'>;
	/** Read at the gesture: every branch below checks the mode in force then. */
	reading: Reading;
	/** Clears the caret a still click leaves in reading mode, noting where it was. */
	readingFocus: Pick<ReadingFocus, 'noteClick'>;
}

/** What a secondary press means, read at the press: it can move the caret out of a shown source,
 *  which redraws the line before `contextmenu` arrives. */
interface ContextPress {
	/** The press landed on the user's own range. */
	range: boolean;
	onWidget: boolean;
	/** The caret for the press's point, as a click there would place it. */
	atPoint: (() => void) | null;
	/** The caret for a press in a surface's padding row, at the column under it. */
	inPadding: (() => void) | null;
}

export interface RootGestures {
	/** `root` is the element the installing effect captured, not a live binding. */
	install(root: HTMLElement): () => void;
	/** Where a click on empty space puts the caret, for a point the caller chose to answer. */
	placeCaretAtPoint(root: HTMLElement, x: number, y: number): boolean;
	/** The caret a context menu opens over: where its press pointed, read at the press, or at the
	 *  menu event's point when no press opened it (the keyboard's menu key). */
	placeMenuCaret(root: HTMLElement, x: number, y: number): boolean;
	/** Whether a context menu's press landed on a selected range (Safari selects the word under a
	 *  right-click before `contextmenu`); a menu the keyboard opened asks of the live selection. */
	rangeAtContextPress(root: HTMLElement): boolean;
}

// Empty space and a block's non-editable parts (a rendered equation, a diagram, a whole-block
// input proxy) grow no native selection, so the editor runs the drag from there.
const NOT_A_DRAG_START =
	`${BLOCK_TEXT_SELECTOR}, ` +
	'button:not(.editor-tail-row), input, textarea, select, a, summary, [role="checkbox"], ' +
	'.code-rail, .table-add-zone, .md-menu, .block-drag-handle';

export function createRootGestures(deps: RootGesturesDeps): RootGestures {
	const deadSpaceCaret = createDeadSpaceCaret({
		getBlockComponent: (path) => deps.getBlockComponent(path),
		resetSelectionForClick: () =>
			resetForPointerDown(deps.selection, deps.caretWriter, deps.caretMemory, false),
		gapScope: {
			getDoc: deps.getDoc,
			selection: deps.selection,
			caretWriter: deps.caretWriter,
			getPresentationMode: deps.reading.mode
		},
		lastBlockIndex: () => deps.getDoc().children.length - 1,
		land: (pos) => deps.land(pos)
	});

	function dragStartsHere(root: HTMLElement, target: EventTarget | null): boolean {
		if (claimsPointerGesture(target)) return false;
		if (deadSpaceCaret.isDeadSpaceTarget(root, target)) return true;
		if (!(target instanceof Element) || !root.contains(target)) return false;
		return target.closest(NOT_A_DRAG_START) === null;
	}

	/** The editable block `el` sits in, its node and its content element. */
	function blockAt(el: Element): LinkPointQuery | null {
		const path = findSurfacePathForElement(el);
		if (!path) return null;
		const block = nodeAt(deps.getDoc(), path);
		if (block === null || !isBlockNode(block)) return null;
		const contentEl = deps.getBlockElByPath(path);
		return contentEl ? { contentEl, block, path, reading: deps.reading } : null;
	}

	/** Open the card on the link `el` renders, or report that nothing there is one. The caret
	 *  has already landed from mousedown, which is the one the card state snapshots. */
	function openLinkCard(el: Element): boolean {
		const at = blockAt(el);
		const hit = at && resolveLinkAtPoint(at);
		return hit ? deps.linkCard.open(hit.target) : false;
	}

	/** Whether a rendered anchor draws something a click follows (a construct, or a widget that
	 *  claims the click): the answer Edit link edits by, so nothing follows that can't be edited. */
	function anchorFollows(anchor: Element): boolean {
		const at = blockAt(anchor);
		if (!at) return false;
		const offset = rawOffsetAt(at.contentEl, anchor, 0);
		return clickFollowsAt(at.block, offset, deps.reading);
	}

	function blurEditingSurface(root: HTMLElement): void {
		const active = document.activeElement;
		if (active instanceof HTMLElement && root.contains(active) && active !== root) active.blur();
	}

	// The latest secondary press (a right button, or Control with the left on a Mac); a key or any
	// other press in between, a touch's long-press included, leaves none.
	let contextPress: ContextPress | null = null;

	function install(root: HTMLElement): () => void {
		// Per install: rebinding the root starts with no click in progress. A press on a block's own
		// box or the margin counts in every mode; only an editing mode runs the drag from it.
		let boxPress = false;
		let boxPlan: (() => void) | null = null;
		let marginDrag = false;
		let marginSession: { dispose(): void } | null = null;

		const handleClick = (e: MouseEvent) => {
			// A double click's word and a drag's range stay for the clipboard.
			if (e.detail === 1 && !deps.presses.travelled(e)) deps.readingFocus.noteClick();
			const target = e.target as Element | null;
			// The anchor carries the destination after the host's rewrite and the scheme check.
			const anchor = target?.closest('a[href]') ?? null;
			// The host's own header follows the page's link behaviour, not click-to-edit.
			if (anchor && deps.isHostChrome(anchor)) return;
			// A plain click the link doesn't follow opens its card, as does one on a blocked-scheme
			// link (a plain span, and exactly the link a user opens the card to fix).
			const follows = anchor !== null && deps.activationClick(e);
			if (deps.reading.mode() === 'live' && !isModifiedClick(e) && !follows) {
				const linkEl = target?.closest(LINK_ELEMENT_SELECTOR);
				if (linkEl && !deps.isHostChrome(linkEl) && openLinkCard(linkEl)) {
					e.preventDefault();
					return;
				}
			}
			if (anchor) {
				// Always suppressed: cursor placement comes from mousedown.
				e.preventDefault();
				if (follows && anchorFollows(anchor)) deps.activateLink(anchor.getAttribute('href')!, e);
				return;
			}
			const pressed = boxPress;
			const placeOnBox = boxPlan;
			boxPress = marginDrag = false;
			boxPlan = null;
			// A double or triple click places no caret: the multi-click select painted its range.
			if (e.detail >= 2) return;
			if (pressed && deps.presses.travelled(e)) return;
			if (deadSpaceCaret.handleClick(root, e)) return;
			// A still click on a block's own box (a rule, a closed equation's face) places the caret
			// there as empty space does; reading mode declines the caret and the block keeps focus.
			if (pressed && placeOnBox && !deadSpaceCaret.isDeadSpaceTarget(root, e.target)) {
				placeOnBox();
				return;
			}
			// A click on nothing still ends the edit in progress, since the margin click suppressed
			// the browser's own blur.
			if (pressed) blurEditingSurface(root);
		};

		// Starts where a click would put the caret; mousedown's default is suppressed so no native
		// selection fights the drag, and `click` still fires.
		const startMarginDrag = (e: PointerEvent) => {
			boxPress = marginDrag = false;
			boxPlan = null;
			if (e.button !== 0 || e.shiftKey || isModifiedClick(e) || e.altKey) return;
			if (!dragStartsHere(root, e.target)) return;
			const anchor = deadSpaceCaret.anchorAtPoint(root, e.clientX, e.clientY);
			if (!anchor) return;
			boxPress = true;
			// Read at the press, as every click's point is (`dead-space-caret.ts`).
			boxPlan = deadSpaceCaret.isDeadSpaceTarget(root, e.target)
				? null
				: deadSpaceCaret.planAtPoint(root, e.clientX, e.clientY);
			// Reading mode places no caret, and the browser's own drag selects there.
			if (deps.reading.mode() === 'reading') return;
			marginDrag = true;
			resetForPointerDown(deps.selection, deps.caretWriter, deps.caretMemory, false);
			// A block that runs its own drag from a nearby click (a table's cell rectangle) takes
			// it; the generic drag is for blocks that have none.
			if (!('offset' in anchor)) {
				const component = deps.getBlockComponent(anchor.path);
				if (component?.startDragAtPoint?.(e.clientX, e.clientY, e)) return;
			}
			marginSession = installDragListener(
				{
					editorRoot: root,
					scrollContainer: deps.getScrollHost() ?? root,
					selection: deps.selection,
					caretWriter: deps.caretWriter,
					getBlockElByPath: deps.getBlockElByPath,
					lifetimeSignal: deps.getLifetime(),
					paintSameBlock: () => true
				},
				anchor,
				e
			);
		};

		const handleMouseDown = (e: MouseEvent) => {
			deadSpaceCaret.notePress(root, e);
			// The second click of a run belongs to the multi-click select, which runs its own drag.
			if (marginDrag && e.detail >= 2) {
				marginSession?.dispose();
				marginSession = null;
				marginDrag = false;
			}
			if (marginDrag) e.preventDefault();
		};

		return removeAll(
			onRoot(root, 'click', handleClick),
			installMultiClickSelect({
				editorRoot: root,
				selection: deps.selection,
				caretWriter: deps.caretWriter,
				getBlockElByPath: deps.getBlockElByPath,
				getScrollContainer: () => deps.getScrollHost() ?? root,
				lifetimeSignal: deps.getLifetime(),
				marginBlockAt: (target, x, y) =>
					deps.reading.mode() !== 'reading' && dragStartsHere(root, target)
						? deadSpaceCaret.blockPathNearPoint(root, x, y)
						: null,
				pressesSelectedWidget: (target) => pressesSelectedWidget(deps.selection, target)
			}),
			onRoot(root, 'pointerdown', startMarginDrag),
			onRoot(root, 'mousedown', handleMouseDown),
			// Every pointerdown writes the record, since a widget showing its source cancels it and no
			// mousedown follows; a mousedown re-reads only the range, after the block's own pointerdown.
			onRoot<PointerEvent>(root, 'pointerdown', (e) => (contextPress = notePress(root, e, null)), {
				capture: true
			}),
			onRoot<MouseEvent>(
				root,
				'mousedown',
				(e) => (contextPress = notePress(root, e, contextPress)),
				{ capture: true }
			),
			onRoot(root, 'keydown', () => (contextPress = null), { capture: true }),
			onRoot<MouseEvent>(root, 'contextmenu', placeCaretForMenu, {
				capture: true
			})
		);
	}

	/** `planned` is the record this press's pointerdown wrote, whose caret plans it keeps. */
	function notePress(
		root: HTMLElement,
		e: MouseEvent,
		planned: ContextPress | null
	): ContextPress | null {
		if (!isSecondaryPress(e)) return null;
		// A widget the editor holds selected is the user's own selection, as a range is. A range
		// across blocks is painted by the editor, so the browser's rectangles don't show it.
		const range =
			pressesSelectedWidget(deps.selection, e.target) ||
			(deps.selection.isCrossBlock
				? nativeRangeIn(root)
				: rangeCoversPoint(root, e.clientX, e.clientY));
		const onWidget = e.target instanceof Element && !!e.target.closest('[data-inline-widget]');
		if (planned) return { ...planned, range, onWidget };
		return {
			range,
			onWidget,
			atPoint: deadSpaceCaret.planAtPoint(root, e.clientX, e.clientY),
			inPadding: planPaddingPress(deps.caretWriter, e)
		};
	}

	// Before any menu reads the caret: Safari's word select stays for the clipboard rows, while a
	// widget it selected whole gives way to the caret every other engine puts beside it.
	function placeCaretForMenu(): void {
		if (!contextPress || contextPress.range || deps.selection.isCrossBlock) return;
		if (deps.reading.mode() === 'reading') return;
		if (contextPress.onWidget) contextPress.atPoint?.();
		else contextPress.inPadding?.();
	}

	function rangeAtContextPress(root: HTMLElement): boolean {
		return contextPress?.range ?? nativeRangeIn(root);
	}

	return {
		install,
		placeCaretAtPoint: (root, x, y) => deadSpaceCaret.placeAtPoint(root, x, y),
		placeMenuCaret: (root, x, y) => {
			const place = contextPress ? contextPress.atPoint : deadSpaceCaret.planAtPoint(root, x, y);
			place?.();
			return place !== null;
		},
		rangeAtContextPress
	};
}
