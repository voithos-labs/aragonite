// @vitest-environment jsdom
//
// Which blocks need an owned Home door: the first landable position abuts an opaque island —
// no text node holds it, so the engine's Home seats the caret past the island (GH #115).
// Miss-analysis: the bounds suite pinned WHERE the landable start is, but nothing pinned
// whether a text position can express it, the fact the Home arm dispatches on.
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
