// @vitest-environment jsdom
//
// A remembered caret and the text it counts into travel together. The write path a kind wraps
// around its commits maps the commit caret through that kind's `normalizeRawWrite` (a table cell
// escapes every free `|`); `setPendingCursor` skips that path, so its offset can only be mapped
// if the writer hands over the text it counts into. The two branches that compose new text need
// it; the atomic-delete branch is the other half, leaving the caret ahead of every changed byte.
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

/** [prose][CST widget][prose], the shape a prose block renders. */
function mountWidget(source: string, kind: string) {
	const { node, el, widgets, inlineWidgets } = mountWidgetBlock(source, kind);
	return { ...dispatchOver(node, el, false), widget: inlineWidgets[0], island: widgets[0] };
}

/** A zero-width decoration widget at the block's end, with `onEdge: 'step-over'`. */
function mountIsland(source: string, at: number) {
	const { node, el, island } = mountIslandBlock(source, at);
	return { ...dispatchOver(node, el, true), island };
}

installEdgeDispatchCleanup();

describe('a branch that composes new text reports what its caret addresses', () => {
	it('typing beside a CST widget puts the caret against the raw it just wrote', () => {
		const b = mountWidget('hello ![a](u) world', 'image');
		caretAfter(b.island);

		expect(b.dispatch.handleKeydown(key('z'), asRawOffset(b.widget.end))).toBe(true);
		expect(b.parks).toEqual([
			{ offset: b.widget.end + 1, source: 'widget', writtenText: 'hello ![a](u)z world' }
		]);
	});

	it('typing beside a decoration widget puts the caret against the display it just wrote', () => {
		const b = mountIsland('hello\n', 5);
		caretAfter(b.island);

		expect(b.dispatch.handleKeydown(key('z'), asRawOffset(5))).toBe(true);
		expect(b.parks).toEqual([{ offset: 6, source: 'island', writtenText: 'helloz' }]);
	});

	// The decoration edit path reports its text on both branches. Its delete maps to itself, but
	// the rule belongs to the branch as a whole: splitting it per case is how a later caller misses.
	it('deleting through a widget reports its text too, mapping to identity', () => {
		const b = mountIsland('hello\n', 5);
		caretAfter(b.island);

		expect(b.dispatch.handleKeydown(key('Backspace'), asRawOffset(5))).toBe(true);
		expect(b.parks).toEqual([{ offset: 4, source: 'island', writtenText: 'hell' }]);
	});
});

describe('a branch that slices raw reports no text: it puts the caret ahead of every changed byte', () => {
	it('an atomic widget delete puts the caret at the widget start', () => {
		const b = mountWidget('a&copy;b', 'entityReference');

		expect(b.dispatch.handleKeydown(key('Backspace'), asRawOffset(b.widget.end))).toBe(true);
		expect(b.parks).toEqual([{ offset: b.widget.start, source: 'widget', writtenText: undefined }]);
	});
});
