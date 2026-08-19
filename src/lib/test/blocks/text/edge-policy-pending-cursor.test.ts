// @vitest-environment jsdom
//
// A parked caret and the text it addresses travel together. The block-edit door a kind wraps
// around its writes maps the COMMIT caret through the kind's `normalizeRawWrite` (tableCell
// escapes every free `|`); `setPendingCursor` bypasses that door, so its offset can only be mapped
// if the writer hands over the text it addresses. The two arms that COMPOSE new text need it; the
// atomic-delete arm is the negative half, parking ahead of every byte the write can change.
import { describe, expect, it } from 'vitest';
import { asRawOffset } from '$lib/cursor/coordinate-spaces';
import type { CstNode } from '$lib/core/nodes';
import { mountWidgetBlock } from './math-widget-fixture';
import {
	caretAfter,
	installEdgeDispatchCleanup,
	key,
	makeEdgeDispatch,
	mountIslandBlock
} from './edge-policy-fixture';

interface Park {
	offset: number | null;
	source: string;
	writtenText?: string;
}

function dispatchOver(node: CstNode, el: HTMLElement, hasIslands: boolean) {
	const parks: Park[] = [];
	const { dispatch } = makeEdgeDispatch(node, el, {
		hasIslands: () => hasIslands,
		setPendingCursor: (offset, source, writtenText) => parks.push({ offset, source, writtenText })
	});
	return { dispatch, parks };
}

/** [prose][CST widget island][prose] — the shape a prose block renders. */
function mountWidget(source: string, kind: string) {
	const { node, el, widgets, inlineWidgets } = mountWidgetBlock(source, kind);
	return { ...dispatchOver(node, el, false), widget: inlineWidgets[0], island: widgets[0] };
}

/** A zero-width decoration widget island at the block's tail — `onEdge:'step-over'`. */
function mountIsland(source: string, at: number) {
	const { node, el, island } = mountIslandBlock(source, at);
	return { ...dispatchOver(node, el, true), island };
}

installEdgeDispatchCleanup();

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

	// The island edit funnel reports its text on both branches. Its delete maps to identity, but the
	// rule belongs to the arm: splitting it per branch is how a later insert-flavoured caller misses.
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
