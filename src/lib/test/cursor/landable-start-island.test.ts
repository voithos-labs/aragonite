// @vitest-environment jsdom
//
// Which blocks need an owned Home door: the first landable position abuts an opaque island —
// no text node holds it, so the engine's Home seats the caret past the island (GH #115).
// Miss-analysis: the bounds suite pinned WHERE the landable start is, but nothing pinned
// whether a text position can express it, the fact the Home arm dispatches on.
import { describe, it, expect, afterEach } from 'vitest';
import { landableStartAbutsIsland } from '../../cursor/widget-offset';
import { buildAmbientSpan } from '../../ambient/ambient-dom';

/** A block element under one presentation mode, holding `parts` in order. */
function mount(mode: string | undefined, ...parts: Node[]): HTMLElement {
	const root = document.createElement('div');
	if (mode) root.setAttribute('data-presentation', mode);
	const block = document.createElement('div');
	block.setAttribute('contenteditable', 'true');
	block.append(...parts);
	root.appendChild(block);
	document.body.appendChild(root);
	return block;
}

function span(className: string, text: string): HTMLElement {
	const el = document.createElement('span');
	el.className = className;
	el.textContent = text;
	return el;
}

function widget(raw: string): HTMLElement {
	const el = document.createElement('span');
	el.setAttribute('data-inline-widget', '');
	el.setAttribute('contenteditable', 'false');
	el.setAttribute('data-source-start', '0');
	el.setAttribute('data-source-end', String(raw.length));
	return el;
}

const text = (s: string) => document.createTextNode(s);

afterEach(() => document.body.replaceChildren());

describe('landableStartAbutsIsland', () => {
	const rows: Array<[string, () => HTMLElement, boolean]> = [
		['text-leading block', () => mount(undefined, text('plain tail')), false],
		['widget-leading block in source', () => mount(undefined, widget('![p](u)'), text(' t')), true],
		['widget-leading block in live', () => mount('live', widget('![p](u)'), text(' t')), true],
		[
			'hidden run then widget in live',
			() => mount('live', span('md-marker', '*'), widget('![p](u)'), span('md-marker', '*')),
			true
		],
		[
			'hidden run then text in live',
			() => mount('live', span('md-marker', '**'), text('bold'), span('md-marker', '**')),
			false
		],
		[
			'ambient span then widget',
			() => mount(undefined, buildAmbientSpan('- '), widget('![p](u)')),
			true
		],
		['ambient span then text', () => mount(undefined, buildAmbientSpan('- '), text('tail')), false],
		['empty block', () => mount('live'), false]
	];

	for (const [name, build, expected] of rows) {
		it(`${name} → ${expected}`, () => {
			expect(landableStartAbutsIsland(build())).toBe(expected);
		});
	}
});
