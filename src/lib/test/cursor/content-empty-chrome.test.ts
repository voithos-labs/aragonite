// @vitest-environment jsdom
//
// Chrome standing over no content: which containers the render path stamps, and what the stamp
// does to the walk. A block whose only bytes are its own markers has no landable caret position
// while they hide, so the two consumers of the hiding rule — this walk and the stylesheet — both
// let that chrome paint, in live and the preview rungs but never in reading.
// Miss-analysis: the walk's own tests mounted only blocks with content beside their markers, so
// the degenerate `{len, len}` bound was asserted as a bound and never as a caret trap.
import { describe, it, expect, afterEach } from 'vitest';
import {
	holdsOnlyMarkerChrome,
	isHiddenMarkerRoot,
	landableDomTextBounds,
	paintsNoLandableContent,
	screenVisibilityOf
} from '../../cursor/widget-offset';
import { buildAmbientSpan } from '../../ambient/ambient-dom';
import { mountBlock, span, text, widget } from './chrome-fixtures';

afterEach(() => document.body.replaceChildren());

describe('holdsOnlyMarkerChrome — the stamp condition', () => {
	it('holds for a block whose only bytes are its own prefix or fence lines', () => {
		expect(holdsOnlyMarkerChrome(mountBlock({}, span('md-marker', '# ')))).toBe(true);
		expect(
			holdsOnlyMarkerChrome(
				mountBlock({}, span('md-fence-line', '```\n'), span('md-fence-line', '```'))
			)
		).toBe(true);
		// Inline chrome counts the same: a link with no text (`[](u)`) is two marker spans.
		expect(
			holdsOnlyMarkerChrome(mountBlock({}, span('md-marker', '['), span('md-marker', '](u)')))
		).toBe(true);
	});

	it('declines the moment anything landable stands behind the chrome', () => {
		expect(holdsOnlyMarkerChrome(mountBlock({}, span('md-marker', '# '), text('x')))).toBe(false);
		// A fence with an EMPTY body line still has a line the caret can sit on.
		expect(
			holdsOnlyMarkerChrome(
				mountBlock({}, span('md-fence-line', '```\n'), text('\n'), span('md-fence-line', '```'))
			)
		).toBe(false);
		expect(holdsOnlyMarkerChrome(mountBlock({}, span('md-marker', '**'), widget('$x$')))).toBe(
			false
		);
	});

	it('declines a block with no chrome at all, empty or not', () => {
		expect(holdsOnlyMarkerChrome(mountBlock({}))).toBe(false);
		expect(holdsOnlyMarkerChrome(mountBlock({}, text('plain')))).toBe(false);
	});

	it('reads the ambient island as neither chrome nor content', () => {
		// `- ` with an empty child: the island keeps its box, so the caret already has a seat.
		expect(holdsOnlyMarkerChrome(mountBlock({}, buildAmbientSpan('- ')))).toBe(false);
		// `- # `: the heading's own prefix is chrome standing over nothing, island or not.
		expect(
			holdsOnlyMarkerChrome(mountBlock({}, buildAmbientSpan('- '), span('md-marker', '# ')))
		).toBe(true);
	});

	// The stylesheet's override names two families; a ref label is metadata that stays hidden, so
	// a block holding only labels would be stamped for a paint that never comes.
	it('a reference label is chrome the stamp does not paint, and never content', () => {
		expect(holdsOnlyMarkerChrome(mountBlock({}, span('md-ref-label', '[ref]')))).toBe(false);
		// #141's shape: a label BESIDE paintable chrome must not read as content standing behind
		// it, or the block goes unstamped, paints nothing, and G1.33 fires with no paint available.
		const withLabel = mountBlock(
			{ mode: 'live', stamped: true },
			span('md-marker', '['),
			span('md-ref-label', '[ref]')
		);
		expect(holdsOnlyMarkerChrome(withLabel)).toBe(true);
		expect(landableDomTextBounds(withLabel)).toEqual({ start: 0, end: 1 });
	});
});

describe('the stamp in the walk', () => {
	it('makes a heading prefix landable in live, and leaves it unreachable unstamped', () => {
		const stamped = mountBlock({ mode: 'live', stamped: true }, span('md-marker', '# '));
		expect(landableDomTextBounds(stamped)).toEqual({ start: 0, end: 2 });

		const bare = mountBlock({ mode: 'live' }, span('md-marker', '# '));
		expect(landableDomTextBounds(bare)).toEqual({ start: 2, end: 2 });
	});

	it('paints the same two families the stylesheet does, and no third', () => {
		const marker = mountBlock({ mode: 'live', stamped: true }, span('md-marker', '# '));
		expect(isHiddenMarkerRoot(marker.firstElementChild!, marker)).toBe(false);

		const fence = mountBlock({ mode: 'live', stamped: true }, span('md-fence-line', '```'));
		expect(isHiddenMarkerRoot(fence.firstElementChild!, fence)).toBe(false);

		const label = mountBlock({ mode: 'live', stamped: true }, span('md-ref-label', '[ref]'));
		expect(isHiddenMarkerRoot(label.firstElementChild!, label)).toBe(true);
	});

	it('applies to the preview rungs and never to reading', () => {
		for (const mode of ['preview-block', 'preview-inline']) {
			const block = mountBlock({ mode, stamped: true }, span('md-marker', '# '));
			expect(landableDomTextBounds(block), mode).toEqual({ start: 0, end: 2 });
		}
		const reading = mountBlock({ mode: 'reading', stamped: true }, span('md-marker', '# '));
		expect(landableDomTextBounds(reading)).toEqual({ start: 2, end: 2 });
	});
});

describe('screenVisibilityOf — the reading a rewrite seam takes', () => {
	it('reports the mode and the stamp the container carries', () => {
		expect(screenVisibilityOf(mountBlock({ mode: 'live', stamped: true }))).toEqual({
			hidesMarkers: true,
			chromePaints: true
		});
		expect(screenVisibilityOf(mountBlock({ mode: 'live' }))).toEqual({
			hidesMarkers: true,
			chromePaints: false
		});
		// Reading takes no keystrokes, so a construct with nothing behind its chrome may paint
		// nothing there, stamp or not.
		expect(screenVisibilityOf(mountBlock({ mode: 'reading', stamped: true })).chromePaints).toBe(
			false
		);
	});

	// An unmounted surface (a composition committing before the block's first render) has no mode
	// to read: source hides nothing, so no seam finds a run to move.
	it('reads an unmounted surface as source', () => {
		expect(screenVisibilityOf(null)).toEqual({ hidesMarkers: false, chromePaints: false });
		expect(screenVisibilityOf(mountBlock({}))).toEqual({
			hidesMarkers: false,
			chromePaints: false
		});
	});
});

describe('paintsNoLandableContent — what the caret guard refuses', () => {
	it('holds for an unstamped chrome-only block and falls the moment it paints', () => {
		expect(paintsNoLandableContent(mountBlock({ mode: 'live' }, span('md-marker', '# ')))).toBe(
			true
		);
		expect(
			paintsNoLandableContent(mountBlock({ mode: 'live', stamped: true }, span('md-marker', '# ')))
		).toBe(false);
	});

	it('leaves an empty block and an ambient-fronted one alone', () => {
		expect(paintsNoLandableContent(mountBlock({ mode: 'live' }))).toBe(false);
		expect(paintsNoLandableContent(mountBlock({ mode: 'live' }, buildAmbientSpan('- ')))).toBe(
			false
		);
	});

	it('is silent in source mode, where nothing hides', () => {
		expect(paintsNoLandableContent(mountBlock({}, span('md-marker', '# ')))).toBe(false);
	});
});
