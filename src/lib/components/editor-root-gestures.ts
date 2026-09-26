/**
 * Editor-root pointer gestures: click handling in priority order, first match wins (the link
 * card, link activation, the caret for a click on empty space, a click on a block's own box),
 * the margin drag the browser cannot start from a non-editable element, and the multi-click
 * handling over the same click test. The installing `$effect` stays in `Editor.svelte` as a
 * check plus one install call.
 */

import type { BlockComponent } from '../block-component';
import type { CaretMemory } from '../cursor/caret-memory';
import type { UserScrollport } from '../cursor/scroll-ancestors';
import type { BlockElLookup, DocumentGetter } from '../editor-keys';
import { resetForPointerDown } from '../selection/cross-block/pointer';
import { createDeadSpaceCaret } from '../selection/dead-space-caret';
import { installDragListener } from '../selection/drag-pointer';
import { installMultiClickSelect } from '../selection/multi-click';
import { findSurfacePathForElement } from '../selection/path-lookup';
import { claimsPointerGesture } from '../selection/pointer-gesture';
import type { SelectionState } from '../selection/selection-state.svelte';
import { isBlockNode, nodeAt } from '../tree-operations/node-primitives';
import { widgetSourceRange } from '../core/inline/inline-widgets';
import type { WidgetSelectionState } from './image/widget-selection-state.svelte';
import { LINK_ELEMENT_SELECTOR, resolveLinkAtPoint } from './blocks/text/link-at-point';
import { onRoot, removeAll } from './editor-root-listeners';
import type { LinkCardState } from './link-card/link-card-state.svelte';
import type { Reading } from '../schema/reading';

export interface RootGesturesDeps {
	getDoc: DocumentGetter;
	selection: SelectionState;
	caretMemory: Pick<CaretMemory, 'forget'>;
	getBlockElByPath: BlockElLookup;
	getBlockComponent(path: number[]): BlockComponent | null;
	/** How a block gets mounted: what a click below the last mounted block goes through. */
	revealPath(path: number[]): Promise<BlockComponent | null>;
	getScrollHost(): UserScrollport | null;
	getLifetime(): AbortSignal;
	isHostChrome(node: Node | null): boolean;
	activateLink(href: string, event: MouseEvent): void;
	linkCard: Pick<LinkCardState, 'open'>;
	/** Read at the gesture: every branch below checks the mode in force then. */
	reading: Reading;
	/** Which inline widget is selected whole, so the click order can leave a run on it alone. */
	widgetSelection: Pick<WidgetSelectionState, 'isSelected'>;
}

export interface RootGestures {
	/** `root` is the element the installing effect captured, not a live binding. */
	install(root: HTMLElement): () => void;
	/** Where a click on empty space puts the caret, for a point the caller chose to answer. */
	placeCaretAtPoint(root: HTMLElement, x: number, y: number): boolean;
}

// Empty space, and the parts of a block that are neither editable nor controls (a rendered
// equation, a diagram, a card's face): the browser cannot grow a selection from a click there,
// so the editor runs the drag itself. A whole-block input proxy is editable in name only.
const NOT_A_DRAG_START =
	'[contenteditable="true"]:not([data-whole-block-input]), ' +
	'button:not(.editor-tail-row), input, textarea, select, a, summary, [role="checkbox"], ' +
	'.code-rail, .table-add-zone, .md-menu, .block-drag-handle';

const DRAG_SLOP_PX = 3;

export function createRootGestures(deps: RootGesturesDeps): RootGestures {
	const deadSpaceCaret = createDeadSpaceCaret({
		getBlockComponent: (path) => deps.getBlockComponent(path),
		resetSelectionForClick: () => resetForPointerDown(deps.selection, deps.caretMemory, false),
		gapScope: {
			getDoc: deps.getDoc,
			selection: deps.selection,
			getPresentationMode: deps.reading.mode
		},
		lastBlockIndex: () => deps.getDoc().children.length - 1,
		revealBlock: (index) => deps.revealPath([index])
	});

	function pressesSelectedWidget(target: EventTarget | null): boolean {
		const el =
			target instanceof Element ? target.closest('[data-inline-widget][data-source-start]') : null;
		const source = el && widgetSourceRange(el);
		const path = el && findSurfacePathForElement(el);
		return source !== null && path != null && deps.widgetSelection.isSelected(path, source.start);
	}

	function dragStartsHere(root: HTMLElement, target: EventTarget | null): boolean {
		if (claimsPointerGesture(target)) return false;
		if (deadSpaceCaret.isDeadSpaceTarget(root, target)) return true;
		if (!(target instanceof Element) || !root.contains(target)) return false;
		return target.closest(NOT_A_DRAG_START) === null;
	}

	/** Open the card on the link `el` renders, or report that nothing there is one. The caret
	 *  has already landed from mousedown, which is the one the card state snapshots. */
	function openLinkCard(el: Element): boolean {
		const path = findSurfacePathForElement(el);
		if (!path) return false;
		const block = nodeAt(deps.getDoc(), path);
		if (block === null || !isBlockNode(block)) return false;
		const contentEl = deps.getBlockElByPath(path);
		if (!contentEl) return false;
		const hit = resolveLinkAtPoint({ contentEl, block, path, reading: deps.reading });
		if (!hit) return false;
		return deps.linkCard.open(hit.target);
	}

	function blurEditingSurface(root: HTMLElement): void {
		const active = document.activeElement;
		if (active instanceof HTMLElement && root.contains(active) && active !== root) active.blur();
	}

	function install(root: HTMLElement): () => void {
		// Per install: rebinding the root starts with no click in progress.
		let marginDrag = false;
		let marginDown = { x: 0, y: 0 };
		let marginSession: { dispose(): void } | null = null;

		const handleAnchorClick = (anchor: HTMLAnchorElement, e: MouseEvent) => {
			// The host's own header follows the page's link behaviour, not click-to-edit.
			if (deps.isHostChrome(anchor)) return;
			const href = anchor.getAttribute('href');
			if (!href) return;
			// Always suppressed: cursor placement comes from mousedown. Reading mode has no caret
			// for a plain click to place, so there links behave as in a rendered document.
			e.preventDefault();
			if (e.ctrlKey || e.metaKey || deps.reading.mode() === 'reading') deps.activateLink(href, e);
		};

		const handleClick = (e: MouseEvent) => {
			const target = e.target as Element | null;
			// Ahead of the link branch: a link with a blocked scheme renders as a plain span, and
			// it is exactly the link a user opens the card to fix. Mod-click still activates, below.
			if (deps.reading.mode() === 'live' && !e.ctrlKey && !e.metaKey) {
				const linkEl = target?.closest(LINK_ELEMENT_SELECTOR);
				if (linkEl && !deps.isHostChrome(linkEl) && openLinkCard(linkEl)) {
					e.preventDefault();
					return;
				}
			}
			const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
			if (anchor) {
				handleAnchorClick(anchor, e);
				return;
			}
			// A double or triple click places no caret: the multi-click select painted its range.
			if (e.detail >= 2) {
				marginDrag = false;
				return;
			}
			const pressed = marginDrag;
			const dragged =
				pressed &&
				(Math.abs(e.clientX - marginDown.x) > DRAG_SLOP_PX ||
					Math.abs(e.clientY - marginDown.y) > DRAG_SLOP_PX);
			marginDrag = false;
			if (dragged) return;
			if (deadSpaceCaret.handleClick(root, e)) return;
			// A click the editor took on a block's own box (a host's padding beside a table, a rule,
			// a closed equation's face) that did not move is a click on that block; the helper above
			// handles only empty space, so the same lookup happens here.
			if (pressed && !deadSpaceCaret.isDeadSpaceTarget(root, e.target)) {
				if (deadSpaceCaret.placeAtPoint(root, e.clientX, e.clientY)) return;
			}
			// Handled by nothing above: a click on nothing still leaves what was being edited (an
			// equation showing its source closes on blur), since the margin click suppressed the
			// browser's own blur.
			if (pressed) blurEditingSurface(root);
		};

		// The browser cannot grow a selection from a non-editable element into an editable block,
		// so the editor runs the drag itself, starting where a click there would put the caret.
		// The mousedown's default is suppressed so no native selection fights it; `click` fires.
		const startMarginDrag = (e: PointerEvent) => {
			marginDrag = false;
			marginDown = { x: e.clientX, y: e.clientY };
			if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
			if (deps.reading.mode() === 'reading' || !dragStartsHere(root, e.target)) return;
			const anchor = deadSpaceCaret.anchorAtPoint(root, e.clientX, e.clientY);
			if (!anchor) return;
			marginDrag = true;
			resetForPointerDown(deps.selection, deps.caretMemory, false);
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
					getBlockElByPath: deps.getBlockElByPath,
					lifetimeSignal: deps.getLifetime(),
					paintSameBlock: true
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
				getBlockElByPath: deps.getBlockElByPath,
				getScrollContainer: () => deps.getScrollHost() ?? root,
				lifetimeSignal: deps.getLifetime(),
				marginBlockAt: (target, x, y) =>
					deps.reading.mode() !== 'reading' && dragStartsHere(root, target)
						? deadSpaceCaret.blockPathNearPoint(root, x, y)
						: null,
				pressesSelectedWidget
			}),
			onRoot(root, 'pointerdown', startMarginDrag),
			onRoot(root, 'mousedown', handleMouseDown)
		);
	}

	return {
		install,
		placeCaretAtPoint: (root, x, y) => deadSpaceCaret.placeAtPoint(root, x, y)
	};
}
