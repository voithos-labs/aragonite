// Shared scaffolding for the edge-policy-dispatch suites. The base dependencies do nothing:
// every behaviour a test asserts on has to come from the caller's `overrides`, or a test
// could end up asserting against this stub.
import { afterEach } from 'vitest';
import {
	createEdgePolicyDispatch,
	type EdgePolicyDispatchDeps
} from '#lib/components/blocks/text/edge-policy-dispatch.js';
import { parse } from '#lib/core/parser.js';
import { trimTrailingLineEnding } from '#lib/core/lines.js';
import type { BlockEditActions } from '#lib/action-contracts.js';
import { withStoredCaret } from '#lib/editor-actions/stored-caret.js';
import { createSurfaceWrite } from '#lib/components/blocks/surface-write.js';
import { stubBlockEdit } from '#lib/testing/headless-actions.js';
import type { CstNode } from '#lib/core/nodes.js';
import { makePendingMarks } from '#lib/test/harness/editor-actions.js';
import { asPresentationMode } from '#lib/presentation-mode.js';
import { fixtureReading, topLevelStore } from '../../harness/fixture-grammar';
import { createInsertionRecords } from '#lib/caret/next-insertion.js';
import { createTypedPlacement } from '#lib/components/blocks/text/edge-seat.js';
import type { EdgeAffinity } from '#lib/caret/edge-affinity.js';
import { testCaretWriter } from '#lib/test/harness/caret-writer.js';

export { asRawOffset as at } from '#lib/caret/coordinate-spaces.js';

/** `updateBlockContent` argument tuples less the write mode, newest last. The anchor is the caret
 *  the key was dispatched at, which the block records at keydown. */
export type EditTuple = [index: number, content: string, start: number, end: number];

export interface EdgeDispatchHarness {
	dispatch: ReturnType<typeof createEdgePolicyDispatch>;
	handleKeydown: ReturnType<typeof createEdgePolicyDispatch>['handleKeydown'];
	edits: EditTuple[];
	/** The block each container-marker write was asked for, newest last. */
	markerWrites: CstNode[];
}

/** What the block's surface write goes through, for a case that watches the list or the caret. */
export interface SurfaceWriteOverrides {
	blockEdit?: Pick<BlockEditActions, 'updateBlockContent'>;
	requestCaret?: (at: number, opts: { source: string }) => void;
	/** The caret's side on record, which places a typed insertion at a hidden edge. */
	side?: EdgeAffinity | null;
}

export function makeEdgeDispatch(
	node: CstNode | (() => CstNode),
	el: HTMLElement,
	{
		blockEdit: writes,
		requestCaret = () => {},
		side = null,
		...overrides
	}: Partial<EdgePolicyDispatchDeps> & SurfaceWriteOverrides = {}
): EdgeDispatchHarness {
	const readNode = typeof node === 'function' ? node : () => node;
	const edits: EditTuple[] = [];
	const markerWrites: CstNode[] = [];
	// The block records the caret a key was dispatched at, which every write it makes anchors on.
	let keyCaret = 0;
	const blockEdit: BlockEditActions = {
		...stubBlockEdit(),
		updateBlockContent: (index, content, mode, start = 0, end = start) => {
			edits.push([index, content, start, end]);
			return (
				writes?.updateBlockContent(index, content, mode, start, end) ??
				withStoredCaret(Promise.resolve(true), end)
			);
		}
	};
	const deps: EdgePolicyDispatchDeps = {
		caretWriter: testCaretWriter,
		get node() {
			return readNode();
		},
		get index() {
			return 0;
		},
		get containerParent() {
			return null;
		},
		// The mode on the element's `data-presentation` root, as the editor writes it from the reading.
		get reading() {
			return fixtureReading(
				{},
				asPresentationMode(el.closest('[data-presentation]')?.getAttribute('data-presentation'))
			);
		},
		getEl: () => el,
		// The block alone at the top level, unless a case places it in a document of its own.
		storedAs: () => topLevelStore(readNode(), deps.reading),
		hasIslands: () => false,
		getRawSelection: () => null,
		writeText: createSurfaceWrite({
			getNode: readNode,
			getIndex: () => 0,
			getPath: () => [0],
			blockEdit,
			kindCue: { afterTypedWrite: async () => {}, labelAt: () => undefined, dismiss: () => {} },
			getPreEditOffset: () => keyCaret,
			requestCaret,
			holdInsertion: () => createInsertionRecords([]).hold({}, side, placement.insertion)
		}),
		completeMarker: () => markerWrites.push(readNode()),
		setSnapTarget: () => {},
		isRevealing: () => false,
		enterWidget: () => {},
		isReading: () => false,
		pendingMarks: makePendingMarks(),
		offsetFor: (caret, typed) => placement.offsetFor(caret, typed),
		...overrides
	};
	const placement = createTypedPlacement({
		getEl: () => el,
		getNode: readNode,
		reading: deps.reading,
		caretMemory: { side: () => side, noteOutside: () => {} },
		heldSpace: () => ({ at: () => null, inside: () => null, passCloser: () => false })
	});
	const dispatch = createEdgePolicyDispatch(deps);
	// A held range reads as its start, as the block's caret read does.
	const handleKeydown: EdgeDispatchHarness['handleKeydown'] = (e, caret) => {
		keyCaret = deps.getRawSelection()?.start ?? caret ?? 0;
		return dispatch.handleKeydown(e, caret);
	};
	return { dispatch, handleKeydown, edits, markerWrites };
}

// ── DOM scaffolding ──────────────────────────────────────────────────────────

/** A contenteditable element holding `content`, optionally under a data-presentation root. */
export function mountSurface(content: string | Node[], mode?: string): HTMLElement {
	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	if (typeof content === 'string') el.textContent = content;
	else el.append(...content);
	if (mode) {
		const root = document.createElement('div');
		root.setAttribute('data-presentation', mode);
		root.appendChild(el);
		document.body.appendChild(root);
	} else {
		document.body.appendChild(el);
	}
	return el;
}

export function decorationIsland(start: number, end = start): HTMLElement {
	const island = document.createElement('span');
	island.dataset.decorationIsland = '';
	island.dataset.sourceStart = String(start);
	island.dataset.sourceEnd = String(end);
	island.setAttribute('contenteditable', 'false');
	return island;
}

/** `[text before][widget][text after]` for `source`'s first block; a zero-width
 *  `start === end` mounts a widget. Empty sides are left out. */
export function mountIslandBlock(
	source: string,
	start: number,
	end = start,
	mode?: string
): { node: CstNode; el: HTMLElement; island: HTMLElement } {
	const node = parse(source).children[0];
	const display = trimTrailingLineEnding(node.raw);
	const island = decorationIsland(start, end);
	const parts: Node[] = [];
	if (start > 0) parts.push(document.createTextNode(display.slice(0, start)));
	parts.push(island);
	if (end < display.length) parts.push(document.createTextNode(display.slice(end)));
	return { node, el: mountSurface(parts, mode), island };
}

/** Element-level caret directly after `target`, where the browser drops a printable key. */
export function caretAfter(target: Node): void {
	const range = document.createRange();
	range.setStartAfter(target);
	range.collapse(true);
	const sel = window.getSelection()!;
	sel.removeAllRanges();
	sel.addRange(range);
}

export const key = (name: string, modifiers: Partial<KeyboardEvent> = {}): KeyboardEvent =>
	new KeyboardEvent('keydown', { key: name, cancelable: true, ...modifiers });

export function installEdgeDispatchCleanup(): void {
	afterEach(() => {
		document.body.innerHTML = '';
		window.getSelection()?.removeAllRanges();
	});
}
