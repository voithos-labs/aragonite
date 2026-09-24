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
import { renderOptions } from '../harness/fixture-grammar';

// Two pieces of code answer "which bytes does the user see": the node-space rule every live
// rewrite verifies through, and the DOM traversal every caret check reads. This compares the two
// over the same fragment, so a disagreement does not have to be found by a gesture.

// Miss-analysis: the node-space tests fed it nodes and read a string, and the traversal's tests
// mounted spans and read offsets, so neither suite ever put the two answers side by side. A
// construct whose markers paint had the first saying nothing was on screen while the second landed
// a caret on all five bytes, and both suites stayed green.

const PARAMS = { numRuns: 500, seed: freshOrFixedSeed(141141) } as const;

/** The constructs the node-space rule covers exactly. The preview pair is here on a container that
 *  is not focused, which is the shape it answers for: showing their markers is per-span DOM state
 *  and belongs to the traversal. */
const MODES: PresentationMode[] = ['source', 'reading', 'live', 'preview-block', 'preview-inline'];

/** How the block is mounted: the mode on an ancestor, the attribute on the traversal container. */
function mount(raw: string, mode: PresentationMode, contentEmpty: boolean): HTMLElement {
	const root = document.createElement('div');
	if (mode !== 'source') root.setAttribute('data-presentation', mode);
	const block = document.createElement('div');
	block.setAttribute('contenteditable', 'true');
	if (contentEmpty) block.setAttribute(CONTENT_EMPTY_ATTR, '');
	block.appendChild(renderInlineNodes(parseInline(raw, 0, raw.length), raw, renderOptions()));
	root.appendChild(block);
	document.body.appendChild(root);
	// The attribute paints only under focus (the stylesheet's `:focus-within` rule), and the
	// node-space rule is stated over the painted state, so a marked fixture holds focus.
	if (contentEmpty) block.focus();
	return block;
}

/** What the traversal leaves on screen: every text node it does not call hidden marker text. */
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
		screenVisibility(mode, { chromePaints: contentEmpty }),
		renderOptions()
	);
}

afterEach(() => document.body.replaceChildren());

describe('the node-space check and the DOM walk agree on what the reader sees', () => {
	it.each(MODES)('over generated inline source in %s', (mode) => {
		fc.assert(
			fc.property(arbRawString, fc.boolean(), (raw, contentEmpty) => {
				const block = mount(raw, mode, contentEmpty);
				expect(oracleVisibleText(raw, mode, contentEmpty)).toBe(walkVisibleText(block));
			}),
			PARAMS
		);
	});

	// The known case, as a fixture rather than a draw: five bytes the user sees, which the
	// node-space rule answered '' for while the traversal landed a caret on every one of them.
	it('a link with no text reads as five painted bytes once its chrome stands alone', () => {
		expect(oracleVisibleText('[](u)', 'live', true)).toBe('[](u)');
		expect(oracleVisibleText('[](u)', 'live', false)).toBe('');
	});

	// A reference label is the family the attribute does not paint, so it stays hidden.
	it('a reference label stays hidden even where the rest of the chrome paints', () => {
		const raw = '[a][ref]\n\n[ref]: u';
		const nodes = parseInline(raw, 0, 8, () => ({ url: 'u' }));
		const painted = renderedText(
			nodes,
			raw,
			screenVisibility('live', { chromePaints: true }),
			renderOptions()
		);
		expect(painted).toBe('[a]');
	});
});
