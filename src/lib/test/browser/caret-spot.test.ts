// @vitest-environment jsdom
// The caret writer writes a caret only where something shows it: the browser's line, or the drawn
// caret's bar beside a widget with no line box; a caret nothing shows is refused (G1.159).
// Miss-analysis: only the click route asked for the bar beside an image, and no row wrote a caret
// there through any other route, where nothing drew it and Chromium dropped the next key.
import { describe, it, expect, afterEach } from 'vitest';
import { createCaretWriter } from '#lib/browser/caret-writer.js';
import { caretSpotOf, type CaretSpot } from '#lib/browser/caret-spot.js';
import { takeDevWarns } from '../support/warn-gate';
import { mountBlock, span, text, widget } from './chrome-fixtures';
import { buildAmbientSpan } from '../../components/blocks/marker-prefix';

afterEach(() => {
	document.body.replaceChildren();
	window.getSelection()?.removeAllRanges();
});

/** An image-like widget: laid out as a block, so it has no line box beside it. */
function blockWidget(raw: string): HTMLElement {
	const el = widget(raw);
	el.style.display = 'block';
	return el;
}

/** A writer whose drawn caret draws a bar at every edge it is asked for, recording each ask. */
function recordingWriter() {
	const asks: number[] = [];
	const writer = createCaretWriter(
		() => {},
		() => false,
		(_el, raw) => {
			asks.push(raw);
			return true;
		}
	);
	return { writer, asks };
}

function caret() {
	const sel = window.getSelection()!;
	return { node: sel.focusNode, offset: sel.focusOffset };
}

describe('caretSpotOf: how a caret at a spot shows', () => {
	const IMAGE = '![x](i.png)';
	const cases: [string, () => { el: HTMLElement; node: () => Node; offset: number }, CaretSpot][] =
		[
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
				'widget-inline'
			],
			[
				'beside a widget laid out as a block, past a hidden run',
				() => {
					const el = mountBlock({ mode: 'live' }, span('md-marker', '['), blockWidget(IMAGE));
					return { el, node: () => el, offset: 1 };
				},
				'widget-block'
			],
			[
				'beside a block widget and text',
				() => {
					const el = mountBlock({ mode: 'live' }, blockWidget(IMAGE), text(' tail'));
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

describe('the caret writer writes only a caret something shows', () => {
	it('refuses a caret in a block of hidden marker runs, leaving the selection alone', () => {
		const el = mountBlock({ mode: 'live' }, span('md-marker', '@@marker'));
		el.focus();
		const { writer, asks } = recordingWriter();
		window.getSelection()!.removeAllRanges();

		expect(writer.placeCaretAtRaw(el, 0, { clamp: 'exact' })).toBe(false);
		expect(window.getSelection()!.rangeCount).toBe(0);
		expect(asks).toEqual([]);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:caret-paints']);
	});

	// An empty block's chrome paints only once the block has focus, which the write comes before.
	it('writes a caret into a block that has no focus yet as asked', () => {
		const el = mountBlock(
			{ mode: 'live', stamped: true, unfocused: true },
			span('md-marker', '# ')
		);
		const { writer } = recordingWriter();

		expect(writer.placeCaretAtRaw(el, 0, { clamp: 'exact' })).toBe(true);
		expect(takeDevWarns()).toEqual([]);
	});

	it('asks for the bar beside a widget laid out as a block, at the widget edge it wrote', () => {
		const el = mountBlock({ mode: 'live' }, span('md-marker', '['), blockWidget('![x](i.png)'));
		const { writer, asks } = recordingWriter();

		expect(writer.placeCaretAtRaw(el, 12, { clamp: 'exact' })).toBe(true);
		expect(caret()).toEqual({ node: el, offset: 2 });
		expect(asks).toEqual([12]);
	});

	it('leaves the browser its own caret beside an inline widget and in text', () => {
		const el = mountBlock({ mode: 'live' }, text('ab '), widget('$x$'));
		const { writer, asks } = recordingWriter();

		writer.placeCaretAtRaw(el, 6, { clamp: 'exact' });
		writer.placeCaretAtRaw(el, 1, { clamp: 'exact' });
		expect(asks).toEqual([]);
	});

	it('asks for the bar when it moves a caret the browser left inside a block widget', () => {
		const image = blockWidget('![x](i.png)');
		image.append(text('alt'));
		const el = mountBlock({ mode: 'live' }, image);
		const { writer, asks } = recordingWriter();
		window.getSelection()!.collapse(image.firstChild, 1);

		expect(writer.canonicalizeCaret(el)).toBe(true);
		expect(asks).toEqual([11]);
	});

	it('moves a caret the browser put in hidden marker text to the visible text at its offset', () => {
		const el = mountBlock({ mode: 'live' }, span('md-marker', '# '), text('ab'));
		const { writer } = recordingWriter();
		el.focus();
		const hidden = el.firstChild!.firstChild!;
		const sel = window.getSelection()!;
		sel.collapse(el.lastChild, 1);
		Object.assign(sel, { modify: () => sel.collapse(hidden, 2) });

		expect(writer.moveCaretToLineEdge('start')).toBe(true);
		expect(caret()).toEqual({ node: el.lastChild, offset: 0 });
	});
});
