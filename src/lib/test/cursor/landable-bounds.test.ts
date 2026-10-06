// @vitest-environment jsdom
// The furthest a caret can sit at each end of a block, which every check at a block's edge
// compares against: bounds move past hidden marker runs and the container's marker prefix, while
// every other widget the caret cannot enter keeps both of its boundaries.
// Miss-analysis: block exits read the declared content range, blind to unreachable content bytes.
import { describe, it, expect, afterEach } from 'vitest';
import {
	createCaretAnchor,
	findDomTextOffsetTarget,
	landableDomTextBounds
} from '../../cursor/widget-offset';
import { asDomTextOffset } from '../../cursor/coordinate-spaces';
import { buildAmbientSpan } from '../../ambient/ambient-dom';
import { mountBlock, span, text, widget } from './chrome-fixtures';

/** What a `replace` decoration renders: contenteditable="false" text, unlike a widget. */
function island(text: string): HTMLElement {
	const el = document.createElement('span');
	el.setAttribute('data-decoration-island', '');
	el.setAttribute('contenteditable', 'false');
	el.textContent = text;
	return el;
}

afterEach(() => document.body.replaceChildren());

describe('landableDomTextBounds: hidden runs move the bound in', () => {
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
		// `## **bold**`: the block's own prefix and a construct's opener are one unreachable run.
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

	it('collapses both bounds onto the far end when nothing is reachable', () => {
		const block = mountBlock(
			{ mode: 'live' },
			span('md-marker', '```'),
			span('md-marker', '\n```')
		);
		expect(landableDomTextBounds(block)).toEqual({ start: 7, end: 7 });
	});
});

describe('landableDomTextBounds: widgets the caret cannot enter', () => {
	it('steps past the ambient marker in every mode', () => {
		// `- **lead**`: the marker prefix takes no caret and the `**` behind it is unpainted, so the
		// first offset the caret can sit at clears both.
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

	it('leaves both boundaries of an atomic widget reachable', () => {
		// A widget cannot be entered, but it is not unreachable: a caret sits before and after it.
		const block = mountBlock({ mode: 'live' }, widget('$x$'), text('after'));
		expect(landableDomTextBounds(block)).toEqual({ start: 0, end: 8 });
	});

	it('leaves both boundaries of a decoration widget reachable', () => {
		// A widget the caret steps over is the opposite of the marker prefix: its far side is a raw
		// offset of its own, so a bound moved in front of it would turn that step into a block exit.
		const block = mountBlock({ mode: 'live' }, text('lead '), island('HIDDEN'), text(' tail'));
		expect(landableDomTextBounds(block)).toEqual({ start: 0, end: 16 });

		const trailing = mountBlock({ mode: 'live' }, text('lead '), island('HIDDEN'));
		expect(landableDomTextBounds(trailing)).toEqual({ start: 0, end: 11 });
	});
});

// Miss-analysis: every trailing-marker case ended on a character, never on a final `\n`.
describe('landableDomTextBounds: a trailing newline before hidden chrome', () => {
	it('ends before the newline, whose far side is a line nothing paints', () => {
		const emptyBody = mountBlock(
			{ mode: 'live' },
			span('md-fence-line', '$$\n'),
			text('\n'),
			span('md-fence-line', '$$')
		);
		expect(landableDomTextBounds(emptyBody)).toEqual({ start: 3, end: 3 });

		const body = mountBlock(
			{ mode: 'live' },
			span('md-fence-line', '```\n'),
			text('foo\n'),
			span('md-fence-line', '```')
		);
		expect(landableDomTextBounds(body)).toEqual({ start: 4, end: 7 });
	});

	it('keeps the position after the newline when a caret anchor paints its line', () => {
		const anchor = document.createElement('br');
		anchor.dataset.caretAnchor = 'closer';
		const block = mountBlock(
			{ mode: 'live' },
			span('md-fence-line', '```\n'),
			text('foo\n'),
			anchor,
			span('md-fence-line', '\n```')
		);
		expect(landableDomTextBounds(block)).toEqual({ start: 4, end: 8 });
	});
});

// Miss-analysis: every pending-break fixture carried a hidden backslash before its anchors, so no
// case built the line from the anchors alone.
describe('a pending hard break’s line, drawn without a byte of its own', () => {
	const breakAnchor = () => createCaretAnchor('break');
	const glyph = () => span('md-hard-break', '');

	it('keeps the text’s end as the last landable offset', () => {
		const block = mountBlock({ mode: 'live' }, text('abc'), glyph(), breakAnchor(), breakAnchor());
		expect(landableDomTextBounds(block)).toEqual({ start: 0, end: 3 });
	});

	it('takes a caret at the text’s end onto the line, in both modes', () => {
		for (const mode of ['live', undefined]) {
			const [first, last] = [breakAnchor(), breakAnchor()];
			const block = mountBlock({ mode }, text('abc'), glyph(), first, last);
			expect(findDomTextOffsetTarget(block, asDomTextOffset(3))).toEqual({
				node: block,
				offset: [...block.childNodes].indexOf(last)
			});
		}
	});

	it('takes a caret past a hidden closer onto the line', () => {
		const strong = document.createElement('strong');
		strong.append(span('md-marker', '**'), text('b'), span('md-marker', '**'));
		const last = breakAnchor();
		const block = mountBlock({ mode: 'live' }, strong, glyph(), breakAnchor(), last);
		expect(findDomTextOffsetTarget(block, asDomTextOffset(5))).toEqual({
			node: block,
			offset: [...block.childNodes].indexOf(last)
		});
	});
});
