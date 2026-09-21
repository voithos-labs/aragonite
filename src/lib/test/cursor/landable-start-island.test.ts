// @vitest-environment jsdom
//
// Which blocks need to handle Home themselves: the first position the caret can sit at is next
// to a widget it cannot enter, so no text node holds that position and the browser's own Home
// puts the caret past the widget (GH #115).
// Miss-analysis: the bounds suite tested where that first position is, but nothing tested
// whether a text position can express it, which is what the Home handler decides on.
import { describe, it, expect, afterEach } from 'vitest';
import { landableStartAbutsIsland } from '../../cursor/widget-offset';
import { buildAmbientSpan } from '../../ambient/ambient-dom';
import { mountBlock, span, text, widget } from './chrome-fixtures';

afterEach(() => document.body.replaceChildren());

describe('landableStartAbutsIsland', () => {
	const rows: Array<[string, () => HTMLElement, boolean]> = [
		['text-leading block', () => mountBlock({}, text('plain tail')), false],
		['widget-leading block in source', () => mountBlock({}, widget('![p](u)'), text(' t')), true],
		[
			'widget-leading block in live',
			() => mountBlock({ mode: 'live' }, widget('![p](u)'), text(' t')),
			true
		],
		[
			'hidden run then widget in live',
			() =>
				mountBlock(
					{ mode: 'live' },
					span('md-marker', '*'),
					widget('![p](u)'),
					span('md-marker', '*')
				),
			true
		],
		[
			'hidden run then text in live',
			() =>
				mountBlock(
					{ mode: 'live' },
					span('md-marker', '**'),
					text('bold'),
					span('md-marker', '**')
				),
			false
		],
		[
			'ambient span then widget',
			() => mountBlock({}, buildAmbientSpan('- '), widget('![p](u)')),
			true
		],
		['ambient span then text', () => mountBlock({}, buildAmbientSpan('- '), text('tail')), false],
		['empty block', () => mountBlock({ mode: 'live' }), false]
	];

	for (const [name, build, expected] of rows) {
		it(`${name} → ${expected}`, () => {
			expect(landableStartAbutsIsland(build())).toBe(expected);
		});
	}
});
