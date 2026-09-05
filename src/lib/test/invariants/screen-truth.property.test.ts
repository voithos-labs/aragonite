// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import { parseInline } from '../../core/inline';
import { renderInlineNodes } from '../../core/inline-render';
import { renderedText, screenVisibility } from '../../core/inline/visibility';
import { CONTENT_EMPTY_ATTR, isHiddenMarkerText } from '../../cursor/widget-offset';
import type { PresentationMode } from '../../presentation-mode';
import { arbRawString, freshOrFixedSeed } from './arbitraries';
import '../../schema/built-in-descriptors';

// Two models answer "which bytes does the reader see": the node-space oracle every live rewrite
// verifies through, and the DOM walk every caret gate reads. Nothing compared them, so they could
// only be found apart by a gesture. This is that comparison, over the same fragment.

// Miss-analysis: the oracle's own tests fed it nodes and read a string, and the walk's own tests
// mounted spans and read offsets — neither suite ever put the two answers side by side, so a
// container whose chrome PAINTS (the `[](u)` incident) had the oracle saying nothing was on screen
// while the walk landed a caret on all five bytes, and both suites stayed green.

const PARAMS = { numRuns: 500, seed: freshOrFixedSeed(141141) } as const;

/** The rungs the model claims exactly. The preview pair is here on an UNFOCUSED container, which
 *  is the shape it answers for: their reveal is per-span DOM state and stays with the walk. */
const MODES: PresentationMode[] = ['source', 'reading', 'live', 'preview-block', 'preview-inline'];

/** The block surface's own mounting: the mode on an ancestor, the stamp on the walk container. */
function mount(raw: string, mode: PresentationMode, contentEmpty: boolean): HTMLElement {
	const root = document.createElement('div');
	if (mode !== 'source') root.setAttribute('data-presentation', mode);
	const block = document.createElement('div');
	block.setAttribute('contenteditable', 'true');
	if (contentEmpty) block.setAttribute(CONTENT_EMPTY_ATTR, '');
	block.appendChild(renderInlineNodes(parseInline(raw, 0, raw.length), raw));
	root.appendChild(block);
	document.body.appendChild(root);
	return block;
}

/** What the WALK leaves on screen: every text node it does not classify as hidden marker text. */
function walkVisibleText(block: HTMLElement): string {
	const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
	let out = '';
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (!isHiddenMarkerText(node, block)) out += node.textContent ?? '';
	}
	return out;
}

function oracleVisibleText(raw: string, mode: PresentationMode, contentEmpty: boolean): string {
	return renderedText(
		parseInline(raw, 0, raw.length),
		raw,
		screenVisibility(mode, { chromePaints: contentEmpty })
	);
}

afterEach(() => document.body.replaceChildren());

describe('the node-space oracle and the DOM walk agree on what the reader sees', () => {
	it.each(MODES)('over generated inline source in %s', (mode) => {
		fc.assert(
			fc.property(arbRawString, fc.boolean(), (raw, contentEmpty) => {
				const block = mount(raw, mode, contentEmpty);
				expect(oracleVisibleText(raw, mode, contentEmpty)).toBe(walkVisibleText(block));
			}),
			PARAMS
		);
	});

	// The shipped incident, as a fixture rather than a draw: five bytes the reader sees, which the
	// oracle answered '' for while the walk landed a caret on every one of them.
	it('a link with no text reads as five painted bytes once its chrome stands alone', () => {
		expect(oracleVisibleText('[](u)', 'live', true)).toBe('[](u)');
		expect(oracleVisibleText('[](u)', 'live', false)).toBe('');
	});

	// A reference label is the family the stamp does NOT paint, so the fold leaves it hidden.
	it('a reference label stays hidden even where the rest of the chrome paints', () => {
		const raw = '[a][ref]\n\n[ref]: u';
		const nodes = parseInline(raw, 0, 8, () => ({ url: 'u' }));
		const painted = renderedText(nodes, raw, screenVisibility('live', { chromePaints: true }));
		expect(painted).toBe('[a]');
	});
});
