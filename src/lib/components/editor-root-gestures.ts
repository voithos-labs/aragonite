/**
 * Editor-root pointer gestures: clicks in priority order (the link card, link activation, the
 * caret for empty space, a block's own box), the margin drag the browser cannot start from a
 * non-editable element, multi-click selection, and where a right-click leaves the caret.
 */

import type { BlockComponent } from '../block-component';
import type { CaretMemory } from '../caret/caret-memory';
import type { CaretWriter } from '../caret/widget-offset';
import type { CaretLanding } from '../selection/caret-landing';
import type { UserScrollport } from '../windowing/scroll-ancestors';
import type { BlockElLookup, DocumentGetter } from '../editor-keys';
import { placeContextPress, resetForPointerDown } from '../selection/cross-block/pointer';
import { createDeadSpaceCaret } from '../selection/dead-space-caret';
import { installDragListener } from '../selection/drag-pointer';
import { installMultiClickSelect } from '../selection/multi-click';
import { findSurfacePathForElement } from '../selection/path-lookup';
import { claimsPointerGesture } from '../selection/pointer-gesture';
import type { SelectionState } from '../selection/selection-state.svelte';
import { isBlockNode, nodeAt } from '../tree-operations/node-primitives';
import { widgetSourceRange } from '../core/inline/inline-widgets';
import { LINK_ELEMENT_SELECTOR, resolveLinkAtPoint } from './blocks/text/link-at-point';
import { onRoot, removeAll } from './editor-root-listeners';
import type { LinkCardState } from './link-card/link-card-state.svelte';
import type { Reading } from '../schema/reading';
import { isModifiedClick, type ActivationClick } from '../activation-click';

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
	linkCard: Pick<LinkCardState, 'open'>;
	/** Read at the gesture: every branch below checks the mode in force then. */
	reading: Reading;
}

export interface RootGestures {
	/** `root` is the element the installing effect captured, not a live binding. */
	install(root: HTMLElement): () => void;
	/** Where a click on empty space puts the caret, for a point the caller chose to answer. */
	placeCaretAtPoint(root: HTMLElement, x: number, y: number): boolean;
}

// Empty space and a block's non-editable parts (a rendered equation, a diagram, a whole-block
// input proxy) grow no native selection, so the editor runs the drag from there.
const NOT_A_DRAG_START =
	'[contenteditable="true"]:not([data-whole-block-input]), ' +
	'button:not(.editor-tail-row), input, textarea, select, a, summary, [role="checkbox"], ' +
	'.code-rail, .table-add-zone, .md-menu, .block-drag-handle';

const DRAG_SLOP_PX = 3;

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

	function pressesSelectedWidget(target: EventTarget | null): boolean {
		const el =
			target instanceof Element ? target.closest('[data-inline-widget][data-source-start]') : null;
		const source = el && widgetSourceRange(el);
		const path = el && findSurfacePathForElement(el);
		return (
			source !== null && path != null && deps.selection.widgetIn(path)?.sourceStart === source.start
		);
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
			// Always suppressed: cursor placement comes from mousedown.
			e.preventDefault();
			if (deps.activationClick(e)) deps.activateLink(href, e);
		};

		const handleClick = (e: MouseEvent) => {
			const target = e.target as Element | null;
			const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
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
			// A still click on a block's own box (padding beside a table, a rule, a closed
			// equation's face) places the caret in that block, as empty space does.
			if (pressed && !deadSpaceCaret.isDeadSpaceTarget(root, e.target)) {
				if (deadSpaceCaret.placeAtPoint(root, e.clientX, e.clientY)) return;
			}
			// A click on nothing still ends the edit in progress, since the margin click suppressed
			// the browser's own blur.
			if (pressed) blurEditingSurface(root);
		};

		// Starts where a click would put the caret; mousedown's default is suppressed so no native
		// selection fights the drag, and `click` still fires.
		const startMarginDrag = (e: PointerEvent) => {
			marginDrag = false;
			marginDown = { x: e.clientX, y: e.clientY };
			if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
			if (deps.reading.mode() === 'reading' || !dragStartsHere(root, e.target)) return;
			const anchor = deadSpaceCaret.anchorAtPoint(root, e.clientX, e.clientY);
			if (!anchor) return;
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
				pressesSelectedWidget
			}),
			onRoot(root, 'pointerdown', startMarginDrag),
			onRoot(root, 'mousedown', handleMouseDown),
			onRoot<MouseEvent>(
				root,
				'contextmenu',
				(e) => placeContextPress(deps.selection, deps.caretWriter, e),
				{
					capture: true
				}
			)
		);
	}

	return {
		install,
		placeCaretAtPoint: (root, x, y) => deadSpaceCaret.placeAtPoint(root, x, y)
	};
}
