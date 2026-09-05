// @vitest-environment jsdom
//
// The walk's landable extremes: where a caret can actually sit in a block, which is what every
// block-edge gate compares against. A hidden marker run holds no caret position at all, and the
// ambient island's far side IS raw 0, so a bound at either end moves past them; every other
// opaque island keeps both of its boundaries.
// Miss-analysis: the exits used to read the kind's declared content range, so no test could
// observe a block whose unreachable bytes the CST calls content — a fence, a cell's `[ref]`.
import { describe, it, expect, afterEach } from 'vitest';
import { landableDomTextBounds } from '../../cursor/widget-offset';
import { buildAmbientSpan } from '../../ambient/ambient-dom';
import { mountBlock, span, text, widget } from './chrome-fixtures';

/** A replace decoration's inert island: contenteditable="false" TEXT, unlike a widget. */
function island(text: string): HTMLElement {
	const el = document.createElement('span');
	el.setAttribute('data-decoration-island', '');
	el.setAttribute('contenteditable', 'false');
	el.textContent = text;
	return el;
}

afterEach(() => document.body.replaceChildren());

describe('landableDomTextBounds — hidden runs move the bound in', () => {
	it('clears a leading and a trailing marker run in live', () => {
		const block = mountBlock(
			{ mode: 'live' },
			span('md-marker', '**'),
			text('bold'),
			span('md-marker', '**')
		);
		expect(landableDomTextBounds(block)).toEqual({ start: 2, end: 6 });
	});

	it('keeps the whole walk in source mode, where the markers paint', () => {
		const block = mountBlock({}, span('md-marker', '**'), text('bold'), span('md-marker', '**'));
		expect(landableDomTextBounds(block)).toEqual({ start: 0, end: 8 });
	});

	it('coalesces adjacent hidden runs of different families', () => {
		// `## **bold**`: a block-own prefix and a construct's opener are one unreachable run.
		const block = mountBlock(
			{ mode: 'live' },
			span('md-marker', '## '),
			span('md-marker', '**'),
			text('bold'),
			span('md-marker', '**')
		);
		expect(landableDomTextBounds(block)).toEqual({ start: 5, end: 9 });
	});

	it('clears a trailing reference label and a fence line alike', () => {
		const withLabel = mountBlock({ mode: 'live' }, text('docs'), span('md-ref-label', '[ref]'));
		expect(landableDomTextBounds(withLabel)).toEqual({ start: 0, end: 4 });

		const fenced = mountBlock({ mode: 'live' }, span('md-fence-line', '```\n'), text('x'));
		expect(landableDomTextBounds(fenced)).toEqual({ start: 4, end: 5 });
	});

	it('collapses both bounds onto the far end when nothing is landable', () => {
		const block = mountBlock(
			{ mode: 'live' },
			span('md-marker', '```'),
			span('md-marker', '\n```')
		);
		expect(landableDomTextBounds(block)).toEqual({ start: 7, end: 7 });
	});
});

describe('landableDomTextBounds — islands the caret cannot enter', () => {
	it('steps past the AMBIENT marker in every mode', () => {
		// `- **lead**`: the ambient prefix is inert and the `**` behind it unpainted, so the
		// first landable walk offset clears both.
		const live = mountBlock(
			{ mode: 'live' },
			buildAmbientSpan('- '),
			span('md-marker', '**'),
			text('lead')
		);
		expect(landableDomTextBounds(live)).toEqual({ start: 4, end: 8 });

		const source = mountBlock({}, buildAmbientSpan('- '), text('lead'));
		expect(landableDomTextBounds(source)).toEqual({ start: 2, end: 6 });
	});

	it('leaves both boundaries of an atomic widget landable', () => {
		// A widget is opaque, not unreachable: a caret sits before and after it.
		const block = mountBlock({ mode: 'live' }, widget('$x$'), text('after'));
		expect(landableDomTextBounds(block)).toEqual({ start: 0, end: 8 });
	});

	it('leaves both boundaries of a decoration island landable', () => {
		// The step-over island is the ambient span's opposite: its far side is a raw offset of
		// its own, so a bound that moved in front of it would turn the step-over into a block exit.
		const block = mountBlock({ mode: 'live' }, text('lead '), island('HIDDEN'), text(' tail'));
		expect(landableDomTextBounds(block)).toEqual({ start: 0, end: 16 });

		const trailing = mountBlock({ mode: 'live' }, text('lead '), island('HIDDEN'));
		expect(landableDomTextBounds(trailing)).toEqual({ start: 0, end: 11 });
	});
});
