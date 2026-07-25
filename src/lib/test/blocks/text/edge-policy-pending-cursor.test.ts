// @vitest-environment jsdom
//
// A parked caret and the text it addresses travel together. The block-edit door a
// kind wraps around its writes maps the COMMIT caret through the kind's
// `normalizeRawWrite` (tableCell escapes every free `|`, moving every offset after
// it); `setPendingCursor` is a separate dep that bypasses that door, so its offset
// can only be mapped if the writer hands over the text the offset addresses.
//
// Exactly the two arms that COMPOSE new text need it. The atomic-delete arm is
// pinned here as the negative half: it parks at the deleted widget's leading edge,
// ahead of every byte the write can change, so no mapping exists to get wrong.
// (`handleAmbient` is the fourth park; it is unreachable at the one ambient length a
// rewriting kind has — a cell carries no marker.)
import { afterEach, describe, expect, it } from 'vitest';
import {
	createEdgePolicyDispatch,
	type EdgePolicyDispatchDeps
} from '$lib/components/blocks/text/edge-policy-dispatch';
import { parse } from '$lib/core/parser';
import { computeInlineContent } from '$lib/core/inline';
import { asRawOffset } from '$lib/cursor/coordinate-spaces';
import type { BlockEditActions } from '$lib/action-contracts';
import type { CstNode, InlineNode } from '$lib/core/nodes';
import { stampMathWidget } from './math-widget-fixture';

interface Park {
	offset: number | null;
	source: string;
	writtenText?: string;
}

function dispatchOver(node: CstNode, el: HTMLElement, hasIslands: boolean) {
	const parks: Park[] = [];
	const deps: EdgePolicyDispatchDeps = {
		get node() {
			return node;
		},
		get index() {
			return 0;
		},
		get linkRef() {
			return undefined;
		},
		getEl: () => el,
		getAmbientLength: () => 0,
		hasIslands: () => hasIslands,
		getRawSelection: () => null,
		blockEdit: { updateBlockContent: () => {} } as unknown as BlockEditActions,
		setPendingCursor: (offset, source, writtenText) => parks.push({ offset, source, writtenText }),
		setSnapTarget: () => {},
		isRevealing: () => false,
		enterWidget: () => {},
		isReading: () => false
	};
	return { dispatch: createEdgePolicyDispatch(deps), parks };
}

/** [prose][CST widget island][prose] — the shape a prose block renders. */
function mountWidget(source: string, kind: string) {
	const node: CstNode = parse(source).children[0];
	const widget = computeInlineContent(node).find((n: InlineNode) => n.kind === kind)!;
	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	const island = stampMathWidget(widget);
	el.append(
		document.createTextNode(node.raw.slice(0, widget.start)),
		island,
		document.createTextNode(node.raw.slice(widget.end).replace(/\n$/, ''))
	);
	document.body.appendChild(el);
	return { ...dispatchOver(node, el, false), widget, island };
}

/** A zero-width decoration widget island at the block's tail — `onEdge:'step-over'`. */
function mountIsland(source: string, at: number) {
	const node: CstNode = parse(source).children[0];
	const island = document.createElement('span');
	island.dataset.decorationIsland = '';
	island.dataset.sourceStart = String(at);
	island.dataset.sourceEnd = String(at);
	island.setAttribute('contenteditable', 'false');
	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	el.append(document.createTextNode(node.raw.replace(/\n$/, '')), island);
	document.body.appendChild(el);
	return { ...dispatchOver(node, el, true), island };
}

function key(name: string): KeyboardEvent {
	return new KeyboardEvent('keydown', { key: name, cancelable: true });
}

/** Element-level caret: the position the browser drops a printable key at. */
function caretAfter(island: HTMLElement): void {
	const range = document.createRange();
	range.setStartAfter(island);
	range.collapse(true);
	const sel = window.getSelection()!;
	sel.removeAllRanges();
	sel.addRange(range);
}

afterEach(() => {
	document.body.innerHTML = '';
	window.getSelection()?.removeAllRanges();
});

describe('an arm that composes new text reports what its caret addresses', () => {
	it('typing beside a CST widget parks against the raw it just wrote', () => {
		const b = mountWidget('hello ![a](u) world', 'image');
		caretAfter(b.island);

		expect(b.dispatch.handleKeydown(key('z'), asRawOffset(b.widget.end))).toBe(true);
		expect(b.parks).toEqual([
			{ offset: b.widget.end + 1, source: 'widget', writtenText: 'hello ![a](u)z world' }
		]);
	});

	it('typing beside a decoration island parks against the display it just wrote', () => {
		const b = mountIsland('hello\n', 5);
		caretAfter(b.island);

		expect(b.dispatch.handleKeydown(key('z'), asRawOffset(5))).toBe(true);
		expect(b.parks).toEqual([{ offset: 6, source: 'island', writtenText: 'helloz' }]);
	});

	// The island edit funnel reports its text on both branches. Its delete maps to
	// identity, but the rule belongs to the arm: splitting it per branch is how a
	// later insert-flavoured caller inherits the omission.
	it('deleting through an island reports its text too, mapping to identity', () => {
		const b = mountIsland('hello\n', 5);
		caretAfter(b.island);

		expect(b.dispatch.handleKeydown(key('Backspace'), asRawOffset(5))).toBe(true);
		expect(b.parks).toEqual([{ offset: 4, source: 'island', writtenText: 'hell' }]);
	});
});

describe('an arm that slices raw reports no text — it parks ahead of every changed byte', () => {
	it('an atomic widget delete parks at the widget start', () => {
		const b = mountWidget('a&copy;b', 'entityReference');

		expect(b.dispatch.handleKeydown(key('Backspace'), asRawOffset(b.widget.end))).toBe(true);
		expect(b.parks).toEqual([{ offset: b.widget.start, source: 'widget', writtenText: undefined }]);
	});
});
