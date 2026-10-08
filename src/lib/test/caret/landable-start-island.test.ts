// @vitest-environment jsdom
// Which blocks handle Home themselves: when the first caret position sits beside a widget the
// caret cannot enter, no text node holds it and the browser's Home lands past the widget.
// Miss-analysis: GH #115; bounds tests found that position but never whether text can express it.
import { describe, it, expect, afterEach } from 'vitest';
import { landableStartAbutsIsland } from '../../caret/widget-offset';
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
