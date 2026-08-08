// @vitest-environment jsdom
//
// Hidden marker runs are caret-opaque: a mode that hides markers with no reveal leaves
// `display:none` text in the walk, which reads must canonicalize out of and writes must
// never seat a range inside.
// Miss-analysis: every existing offset suite builds a bare container with no
// `data-presentation` root, so no test could observe a mode-hidden run at all — the walk
// was only ever exercised in source-mode shape.
import { describe, it, expect, afterEach } from 'vitest';
import { asDomTextOffset, asRawOffset } from '../../cursor/coordinate-spaces';
import {
	domTextOffsetAtNode,
	isHiddenMarkerText,
	snapOutOfHiddenRun
} from '../../cursor/widget-offset';
import { restoreCaretAtWalkOffset } from '../../cursor/focused-caret';
import { findFirstTextNode, findLastTextNode } from '../../cursor/visual-lines';
import { buildAmbientSpan } from '../../ambient/ambient-dom';
import { createAmbientCursorIO } from '../../ambient/ambient-cursor';
import { applyCollapsedCaret } from '../../selection/native-bridge';
import { caretIsInTextContent } from '../../components/blocks/text/click-snap-guard';

interface Fixture {
	block: HTMLElement;
	/** The opening `**` marker span's own text node. */
	openMarker: Text;
	body: Text;
	closeMarker: Text;
	openSpan: HTMLElement;
}

/** `**bold**` (optionally behind a block-own prefix or a list item's ambient `- `) under one
 *  presentation mode. */
function mount(
	options: { mode?: string; focused?: boolean; ambient?: string; blockPrefix?: string } = {}
): Fixture {
	const root = document.createElement('div');
	root.className = 'editor';
	if (options.mode) root.setAttribute('data-presentation', options.mode);
	const host = document.createElement('div');
	host.className = 'block-host';
	if (options.focused) host.setAttribute('data-focused', '');
	const block = document.createElement('div');
	block.setAttribute('contenteditable', 'true');
	block.tabIndex = 0;
	if (options.ambient) block.appendChild(buildAmbientSpan(options.ambient));
	if (options.blockPrefix) block.appendChild(markerSpan(options.blockPrefix));
	const openSpan = markerSpan('**');
	const body = document.createTextNode('bold');
	const closeSpan = markerSpan('**');
	block.append(openSpan, body, closeSpan);
	host.appendChild(block);
	root.appendChild(host);
	document.body.appendChild(root);
	return {
		block,
		openSpan,
		openMarker: openSpan.firstChild as Text,
		body,
		closeMarker: closeSpan.firstChild as Text
	};
}

/** A chrome span of any marker family, appended after the block's content. */
function appendSpan(block: HTMLElement, className: string, text: string): HTMLElement {
	const span = document.createElement('span');
	span.className = className;
	span.textContent = text;
	block.appendChild(span);
	return span;
}

function markerSpan(text: string): HTMLElement {
	const span = document.createElement('span');
	span.className = 'md-marker';
	span.textContent = text;
	return span;
}

function placeCaret(node: Node, offset: number): Selection {
	const sel = window.getSelection()!;
	sel.removeAllRanges();
	const range = document.createRange();
	range.setStart(node, offset);
	range.collapse(true);
	sel.addRange(range);
	return sel;
}

function caretPosition(): { node: Node; offset: number } {
	const range = window.getSelection()!.getRangeAt(0);
	return { node: range.startContainer, offset: range.startOffset };
}

afterEach(() => {
	document.body.replaceChildren();
	window.getSelection()?.removeAllRanges();
});

describe('isHiddenMarkerText — the marker-hiding CSS families, read structurally', () => {
	it('answers false in source mode, where the root carries no presentation attribute', () => {
		const fx = mount();
		expect(isHiddenMarkerText(fx.openMarker, fx.block)).toBe(false);
	});

	it('answers true in the modes that hide markers with no reveal', () => {
		for (const mode of ['live', 'reading']) {
			const fx = mount({ mode });
			expect(isHiddenMarkerText(fx.openMarker, fx.block), mode).toBe(true);
			expect(isHiddenMarkerText(fx.body, fx.block), mode).toBe(false);
			document.body.replaceChildren();
		}
	});

	it('answers false inside a focused preview-block host, true outside it', () => {
		const focused = mount({ mode: 'preview-block', focused: true });
		expect(isHiddenMarkerText(focused.openMarker, focused.block)).toBe(false);
		document.body.replaceChildren();
		const unfocused = mount({ mode: 'preview-block' });
		expect(isHiddenMarkerText(unfocused.openMarker, unfocused.block)).toBe(true);
	});

	it('answers by reveal class for a stamped construct span under preview-inline', () => {
		const fx = mount({ mode: 'preview-inline', focused: true });
		fx.openSpan.setAttribute('data-construct-start', '0');
		expect(isHiddenMarkerText(fx.openMarker, fx.block)).toBe(true);
		fx.openSpan.classList.add('md-construct-reveal');
		expect(isHiddenMarkerText(fx.openMarker, fx.block)).toBe(false);
	});

	it('answers false for an unstamped whole-block marker in a focused preview-inline host', () => {
		// The block-own prefix carries no data-construct-* stamp and reveals with block focus.
		const fx = mount({ mode: 'preview-inline', focused: true });
		expect(isHiddenMarkerText(fx.openMarker, fx.block)).toBe(false);
	});

	it('answers false for a fence line in a focused preview-inline host', () => {
		const fx = mount({ mode: 'preview-inline', focused: true });
		const fence = appendSpan(fx.block, 'md-fence-line', '```\n');
		expect(isHiddenMarkerText(fence.firstChild!, fx.block)).toBe(false);
	});

	it('answers true for an UNSTAMPED ref label in a focused preview-inline host', () => {
		// The stylesheet's unstamped-reveal arm is scoped to `.md-marker`; a ref label reveals
		// only by class. Reachable: a table cell renders inline with no construct stamps in any
		// mode, so its `[ref]` label is unstamped and still display:none.
		const fx = mount({ mode: 'preview-inline', focused: true });
		const label = appendSpan(fx.block, 'md-ref-label', '[ref]');
		expect(isHiddenMarkerText(label.firstChild!, fx.block)).toBe(true);
		label.classList.add('md-construct-reveal');
		expect(isHiddenMarkerText(label.firstChild!, fx.block)).toBe(false);
	});
});

describe('domTextOffsetAtNode — a hidden run has no interior walk positions', () => {
	it('canonicalizes the three DOM positions that paint at one pixel', () => {
		const fx = mount({ mode: 'live' });
		// (blockEl,0) is the block start, outside the run; the two interior reads snap out.
		expect(domTextOffsetAtNode(fx.block, fx.block, 0)).toBe(0);
		expect(domTextOffsetAtNode(fx.block, fx.openMarker, 1)).toBe(2);
		expect(domTextOffsetAtNode(fx.block, fx.body, 0)).toBe(2);
	});

	it('reads a run-start text position as the run start', () => {
		const fx = mount({ mode: 'live' });
		expect(domTextOffsetAtNode(fx.block, fx.openMarker, 0)).toBe(0);
	});

	it('canonicalizes element-level positions inside a coalesced run', () => {
		// `## **bold**`: two adjacent hidden spans are one run [0,5), so an element-level
		// position between them is as interior as a text one — and feeds the block-exit arms.
		const fx = mount({ mode: 'live', blockPrefix: '## ' });
		expect(domTextOffsetAtNode(fx.block, fx.block, 0)).toBe(0);
		expect(domTextOffsetAtNode(fx.block, fx.block, 1)).toBe(0);
		expect(domTextOffsetAtNode(fx.block, fx.openSpan, 0)).toBe(0);
		// The run's far boundary is a real position — the first visible byte.
		expect(domTextOffsetAtNode(fx.block, fx.block, 2)).toBe(5);
	});

	it('leaves source mode alone — the walk still counts marker text verbatim', () => {
		const fx = mount();
		expect(domTextOffsetAtNode(fx.block, fx.openMarker, 1)).toBe(1);
		expect(domTextOffsetAtNode(fx.block, fx.body, 0)).toBe(2);
	});
});

// The offset-space door: no write site calls it (the landing seam keeps carets out of hidden
// text on its own), so these are its only pins until affinity consumes it.
describe('snapOutOfHiddenRun', () => {
	it('moves a run-interior offset to the requested boundary', () => {
		const fx = mount({ mode: 'live' });
		expect(snapOutOfHiddenRun(fx.block, asDomTextOffset(1), 'after')).toBe(2);
		expect(snapOutOfHiddenRun(fx.block, asDomTextOffset(1), 'before')).toBe(0);
	});

	it('crosses a whole coalesced run, not just the span the offset sits in', () => {
		const fx = mount({ mode: 'live', blockPrefix: '## ' });
		for (const offset of [1, 3, 4]) {
			expect(snapOutOfHiddenRun(fx.block, asDomTextOffset(offset), 'after'), `at ${offset}`).toBe(
				5
			);
			expect(snapOutOfHiddenRun(fx.block, asDomTextOffset(offset), 'before'), `at ${offset}`).toBe(
				0
			);
		}
	});

	it('leaves boundaries and visible text untouched', () => {
		const fx = mount({ mode: 'live' });
		for (const offset of [0, 2, 3, 6]) {
			expect(snapOutOfHiddenRun(fx.block, asDomTextOffset(offset), 'after'), `at ${offset}`).toBe(
				offset
			);
		}
	});
});

// The guard is the landing seam these all share, not a snap carried at each door.
describe('caret writes never seat a range in hidden marker text', () => {
	function cursorIO(block: HTMLElement, ambientLength = 0) {
		return createAmbientCursorIO({ getEl: () => block, getAmbientLength: () => ambientLength });
	}

	it('setRaw lands in visible content for a run-interior offset', () => {
		const fx = mount({ mode: 'live' });
		fx.block.focus();
		cursorIO(fx.block).setRaw(asRawOffset(1));
		expect(caretPosition()).toEqual({ node: fx.body, offset: 0 });
	});

	it('setRaw keeps raw 0 addressable at the run start, outside the hidden text', () => {
		const fx = mount({ mode: 'live' });
		fx.block.focus();
		const io = cursorIO(fx.block);
		io.setRaw(asRawOffset(0));
		expect(caretPosition()).toEqual({ node: fx.block, offset: 0 });
		expect(io.getRaw()).toBe(0);
	});

	it('the ambient boundary lands before a hidden run, not inside it', () => {
		// `- **bold**`: the first text node after the ambient span is the hidden `**`.
		const fx = mount({ mode: 'live', ambient: '- ' });
		fx.block.focus();
		const io = cursorIO(fx.block, 2);
		io.setRaw(asRawOffset(0));
		expect(isHiddenMarkerText(caretPosition().node, fx.block)).toBe(false);
		expect(io.getRaw()).toBe(0);
	});

	it('applyCollapsedCaret lands in visible content for a run-interior offset', () => {
		const fx = mount({ mode: 'live' });
		applyCollapsedCaret(fx.block, { path: [0], offset: 1 });
		expect(caretPosition()).toEqual({ node: fx.body, offset: 0 });
	});

	it('restoreCaretAtWalkOffset lands in visible content for a run-interior offset', () => {
		const fx = mount({ mode: 'live' });
		restoreCaretAtWalkOffset(fx.block, asDomTextOffset(1));
		expect(caretPosition()).toEqual({ node: fx.body, offset: 0 });
	});

	it('seats carets in marker text in source mode, where markers are visible', () => {
		const fx = mount();
		fx.block.focus();
		cursorIO(fx.block).setRaw(asRawOffset(1));
		expect(caretPosition()).toEqual({ node: fx.openMarker, offset: 1 });
	});
});

describe('the caret-in-text guards agree that hidden text holds no caret', () => {
	it('caretIsInTextContent answers false inside a hidden run, true in visible text', () => {
		const fx = mount({ mode: 'live' });
		expect(caretIsInTextContent(fx.block, placeCaret(fx.openMarker, 1))).toBe(false);
		expect(caretIsInTextContent(fx.block, placeCaret(fx.body, 1))).toBe(true);
	});

	it('caretIsInTextContent keeps answering true in source mode', () => {
		const fx = mount();
		expect(caretIsInTextContent(fx.block, placeCaret(fx.openMarker, 1))).toBe(true);
	});

	it('the visual-line text-node walks skip hidden runs at both ends', () => {
		const fx = mount({ mode: 'live' });
		expect(findFirstTextNode(fx.block)).toBe(fx.body);
		expect(findLastTextNode(fx.block)).toBe(fx.body);
	});

	it('the visual-line walks still find marker text in source mode', () => {
		const fx = mount();
		expect(findFirstTextNode(fx.block)).toBe(fx.openMarker);
		expect(findLastTextNode(fx.block)).toBe(fx.closeMarker);
	});
});
