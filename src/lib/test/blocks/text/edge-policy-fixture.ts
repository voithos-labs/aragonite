// Shared scaffolding for the edge-policy-dispatch suites. The base dependencies do nothing:
// every behaviour a test asserts on has to come from the caller's `overrides`, or a test
// could end up asserting against this stub.
import { afterEach } from 'vitest';
import {
	createEdgePolicyDispatch,
	type EdgePolicyDispatchDeps
} from '$lib/components/blocks/text/edge-policy-dispatch';
import { parse } from '$lib/core/parser';
import { trimTrailingLineEnding } from '$lib/core/lines';
import type { BlockEditActions } from '$lib/action-contracts';
import { withStoredCaret } from '$lib/editor-actions/stored-caret';
import { createSurfaceWrite } from '$lib/components/blocks/surface-write';
import { stubBlockEdit } from '$lib/testing/headless-actions';
import type { CstNode } from '$lib/core/nodes';
import { makePendingMarks } from '$lib/test/harness/editor-actions';
import { createAutoPairRecord } from '$lib/components/blocks/text/auto-pair-record';
import { asPresentationMode } from '$lib/presentation-mode';
import { fixtureReading, topLevelStore } from '../../harness/fixture-grammar';

export { asRawOffset as at } from '$lib/cursor/coordinate-spaces';

/** `updateBlockContent` argument tuples less the write mode, newest last. The anchor is the caret
 *  the key was dispatched at, which the block records at keydown. */
export type EditTuple = [index: number, content: string, start: number, end: number];

export interface EdgeDispatchHarness {
	dispatch: ReturnType<typeof createEdgePolicyDispatch>;
	handleKeydown: ReturnType<typeof createEdgePolicyDispatch>['handleKeydown'];
	edits: EditTuple[];
}

/** What the block's surface write goes through, for a case that watches the list or the caret. */
export interface SurfaceWriteOverrides {
	blockEdit?: Pick<BlockEditActions, 'updateBlockContent'>;
	requestCaret?: (at: number, opts: { source: string }) => void;
}

export function makeEdgeDispatch(
	node: CstNode | (() => CstNode),
	el: HTMLElement,
	{
		blockEdit: writes,
		requestCaret = () => {},
		...overrides
	}: Partial<EdgePolicyDispatchDeps> & SurfaceWriteOverrides = {}
): EdgeDispatchHarness {
	const readNode = typeof node === 'function' ? node : () => node;
	const edits: EditTuple[] = [];
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
		lineEnding: () => '\n',
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
			requestCaret
		}),
		setSnapTarget: () => {},
		isRevealing: () => false,
		enterWidget: () => {},
		isReading: () => false,
		getEdgeAffinity: () => null,
		pendingMarks: makePendingMarks(),
		ownPairs: createAutoPairRecord().forBlock(),
		...overrides
	};
	const dispatch = createEdgePolicyDispatch(deps);
	// A held range reads as its start, as the block's caret read does.
	const handleKeydown: EdgeDispatchHarness['handleKeydown'] = (e, caret) => {
		keyCaret = deps.getRawSelection()?.start ?? caret ?? 0;
		return dispatch.handleKeydown(e, caret);
	};
	return { dispatch, handleKeydown, edits };
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
