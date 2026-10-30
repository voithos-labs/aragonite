// @vitest-environment jsdom
// The caret writer writes a caret only where something shows it (G1.159), and beside a picture the
// drawn caret's bar shows it, found from the spot itself whatever route put the caret there.
// Miss-analysis: only the click route asked for the bar beside an image, and no row wrote a caret
// there through any other route, where nothing drew it and Chromium dropped the next key.
import { describe, it, expect, afterEach } from 'vitest';
import { createCaretWriter } from '#lib/browser/caret-writer.js';
import { caretSpotOf, frameBeside, type CaretSpot } from '#lib/browser/caret-spot.js';
import { FRAME_ATTR } from '#lib/core/inline/widget-shell.js';
import { takeDevWarns } from '../support/warn-gate';
import { mountBlock, span, text, widget } from './chrome-fixtures';
import { buildAmbientSpan } from '../../components/blocks/marker-prefix';

afterEach(() => {
	document.body.replaceChildren();
	window.getSelection()?.removeAllRanges();
});

const IMAGE = '![x](i.png)';

/** A picture's widget: its kind declares `frame`, which the render stamps. */
function frame(raw: string, start = 0): HTMLElement {
	const el = widget(raw);
	el.setAttribute(FRAME_ATTR, '');
	el.setAttribute('data-source-start', String(start));
	el.setAttribute('data-source-end', String(start + raw.length));
	return el;
}

function anchor(): HTMLBRElement {
	const br = document.createElement('br');
	br.dataset.caretAnchor = 'frame';
	return br;
}

const writer = () =>
	createCaretWriter(
		() => {},
		() => false
	);

function caret() {
	const sel = window.getSelection()!;
	return { node: sel.focusNode, offset: sel.focusOffset };
}

type Spot = () => { el: HTMLElement; node: () => Node; offset: number };

describe('caretSpotOf: how a caret at a spot shows', () => {
	const cases: [string, Spot, CaretSpot][] = [
		[
			'in visible text',
			() => {
				const el = mountBlock({ mode: 'live' }, text('ab'));
				return { el, node: () => el.firstChild!, offset: 1 };
			},
			'text'
		],
		[
			'in hidden marker text',
			() => {
				const el = mountBlock({ mode: 'live' }, span('md-marker', '# '), text('ab'));
				return { el, node: () => el.firstChild!.firstChild!, offset: 1 };
			},
			'none'
		],
		[
			'beside an inline widget',
			() => {
				const el = mountBlock({ mode: 'live' }, widget('$x$'));
				return { el, node: () => el, offset: 1 };
			},
			'widget'
		],
		[
			'beside a picture, past a hidden run',
			() => {
				const el = mountBlock({ mode: 'live' }, span('md-marker', '['), frame(IMAGE));
				return { el, node: () => el, offset: 1 };
			},
			'widget'
		],
		[
			'beside a picture and its line anchor',
			() => {
				const el = mountBlock({ mode: 'live' }, frame(IMAGE), anchor());
				return { el, node: () => el, offset: 1 };
			},
			'line'
		],
		[
			'beside a picture and text',
			() => {
				const el = mountBlock({ mode: 'live' }, frame(IMAGE), text(' tail'));
				return { el, node: () => el, offset: 1 };
			},
			'line'
		],
		[
			'before a placeholder break',
			() => {
				const el = mountBlock({ mode: 'live' }, document.createElement('br'));
				return { el, node: () => el, offset: 0 };
			},
			'line'
		],
		[
			'in an editable holding nothing',
			() => {
				const el = mountBlock({ mode: 'live' });
				return { el, node: () => el, offset: 0 };
			},
			'line'
		],
		[
			'between hidden runs only',
			() => {
				const el = mountBlock({ mode: 'live' }, span('md-marker', '#'), span('md-marker', ' #'));
				return { el, node: () => el, offset: 1 };
			},
			'none'
		],
		[
			"beside an empty block's markers once their chrome paints",
			() => {
				const el = mountBlock({ mode: 'live', stamped: true }, span('md-marker', '# '));
				return { el, node: () => el, offset: 0 };
			},
			'line'
		],
		[
			"after a container's marker prefix",
			() => {
				const el = mountBlock({ mode: 'live' }, buildAmbientSpan('- '));
				return { el, node: () => el, offset: 1 };
			},
			'line'
		],
		[
			'beside the same runs in source mode, which paints them',
			() => {
				const el = mountBlock({}, span('md-marker', '#'), span('md-marker', ' #'));
				return { el, node: () => el, offset: 1 };
			},
			'line'
		]
	];

	it.each(cases)('%s', (_, build, expected) => {
		const { el, node, offset } = build();
		expect(caretSpotOf(el, { node: node(), offset })).toBe(expected);
	});
});

describe('the picture a caret sits beside', () => {
	const cases: [string, Spot, 'before' | 'after', string][] = [
		[
			'after a picture, before its line anchor',
			() => {
				const el = mountBlock({ mode: 'live' }, frame(IMAGE), anchor());
				return { el, node: () => el, offset: 1 };
			},
			'after',
			'0'
		],
		[
			'before a picture opening the block',
			() => {
				const el = mountBlock({ mode: 'live' }, frame(IMAGE), anchor());
				return { el, node: () => el, offset: 0 };
			},
			'before',
			'0'
		],
		[
			'after a picture inside a link, past its hidden markers',
			() => {
				const link = document.createElement('a');
				link.append(frame(IMAGE, 1));
				mountBlock(
					{ mode: 'live' },
					span('md-marker', '['),
					link,
					span('md-marker', '](u)'),
					anchor()
				);
				return { el: link.parentElement!, node: () => link.parentElement!, offset: 3 };
			},
			'after',
			'1'
		],
		[
			'between two pictures, after the first',
			() => {
				const el = mountBlock({ mode: 'live' }, frame(IMAGE), frame(IMAGE, IMAGE.length), anchor());
				return { el, node: () => el, offset: 1 };
			},
			'after',
			'0'
		]
	];

	it.each(cases)('%s', (_, build, side, start) => {
		const { el, node, offset } = build();
		const beside = frameBeside(el, { node: node(), offset });
		expect(beside?.side).toBe(side);
		expect(beside?.frame.getAttribute('data-source-start')).toBe(start);
	});

	it('is none beside a widget that declares no frame, and in text', () => {
		const el = mountBlock({ mode: 'live' }, text('ab '), widget('$x$'));
		expect(frameBeside(el, { node: el, offset: 2 })).toBeNull();
		expect(frameBeside(el, { node: el.firstChild!, offset: 3 })).toBeNull();
	});
});

describe('the caret writer writes only a caret something shows', () => {
	it('refuses a caret in a block of hidden marker runs, leaving the selection alone', () => {
		const el = mountBlock({ mode: 'live' }, span('md-marker', '@@marker'));
		el.focus();
		window.getSelection()!.removeAllRanges();

		expect(writer().placeCaretAtRaw(el, 0, { clamp: 'exact' })).toBe(false);
		expect(window.getSelection()!.rangeCount).toBe(0);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:caret-paints']);
	});

	// An empty block's chrome paints only once the block has focus, which the write comes before.
	it('writes a caret into a block that has no focus yet as asked', () => {
		const el = mountBlock(
			{ mode: 'live', stamped: true, unfocused: true },
			span('md-marker', '# ')
		);

		expect(writer().placeCaretAtRaw(el, 0, { clamp: 'exact' })).toBe(true);
		expect(takeDevWarns()).toEqual([]);
	});

	it('writes the caret after a picture before its line anchor', () => {
		const el = mountBlock({ mode: 'live' }, frame(IMAGE), anchor());

		expect(writer().placeCaretAtRaw(el, IMAGE.length, { clamp: 'exact' })).toBe(true);
		expect(caret()).toEqual({ node: el, offset: 1 });
		expect(takeDevWarns()).toEqual([]);
	});

	// G1.160. Miss-analysis: pictures laid out as blocks for months, and no check read the layout a
	// caret was written beside, so a letter typed after one landing on the next line looked intended.
	it.each([
		['a widget', widget],
		['a picture', frame]
	])('flags a caret written beside %s laid out as a block', (_, make) => {
		const box = make(IMAGE);
		box.style.display = 'block';
		const el = mountBlock({ mode: 'live' }, box, text(' tail'));

		writer().placeCaretAtRaw(el, 0, { clamp: 'exact' });
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:widget-lays-out-inline']);
		box.style.display = 'inline-block';
		writer().placeCaretAtRaw(el, 0, { clamp: 'exact' });
		expect(takeDevWarns()).toEqual([]);
	});

	it('moves a caret the browser put in hidden marker text to the visible text at its offset', () => {
		const el = mountBlock({ mode: 'live' }, span('md-marker', '# '), text('ab'));
		el.focus();
		const hidden = el.firstChild!.firstChild!;
		const sel = window.getSelection()!;
		sel.collapse(el.lastChild, 1);
		Object.assign(sel, { modify: () => sel.collapse(hidden, 2) });

		expect(writer().moveCaretToLineEdge('start')).toBe(true);
		expect(caret()).toEqual({ node: el.lastChild, offset: 0 });
	});
});
