// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { InlineNode } from '../../core/nodes';
import { parseInline } from '../../core/inline';
import { renderInlineNodes } from '../../core/inline-render';
import { buildAmbientSpan } from '../../ambient/ambient-dom';
import { arbInlineSource } from './arbitraries';

// G2.4: the rendered DOM's textContent reproduces the source bytes. Every char
// in raw maps to a DOM text node so caret <-> offset round-trips; markers render
// as dimmed spans whose text still counts. The widget-free corpus excludes
// images and `<br>` (atomic widgets that contribute 0 textContent), so the
// invariant is the clean `textContent === source`. The widget-delta case below
// supplies widgets explicitly and accounts for their zero contribution.

const PARAMS = { numRuns: 1000, seed: 424242 } as const;

function renderToContainer(nodes: InlineNode[], raw: string): HTMLElement {
	const container = document.createElement('div');
	container.appendChild(renderInlineNodes(nodes, raw));
	return container;
}

describe('G2.4 textContent spine (widget-free)', () => {
	it('textContent equals the source bytes', () => {
		fc.assert(
			fc.property(arbInlineSource, (source) => {
				const nodes = parseInline(source, 0, source.length);
				const container = renderToContainer(nodes, source);
				expect(container.textContent).toBe(source);
			}),
			PARAMS
		);
	});

	it('ambient prefix prepends exactly its text to the spine', () => {
		fc.assert(
			fc.property(fc.constantFrom('## ', '- ', '> ', '1. '), arbInlineSource, (prefix, content) => {
				const nodes = parseInline(content, 0, content.length);
				const container = document.createElement('div');
				container.appendChild(buildAmbientSpan(prefix));
				container.appendChild(renderInlineNodes(nodes, content));
				expect(container.textContent).toBe(prefix + content);
			}),
			PARAMS
		);
	});
});

// Atomic widgets contribute 0 textContent; their source bytes live in
// data-source-* attributes, not text nodes. The spine is then the source with
// each widget's byte range removed.
describe('G2.4 textContent spine (atomic-widget delta)', () => {
	const buildImageWidget = (): Node => {
		const shell = document.createElement('span');
		shell.dataset.inlineWidget = '';
		shell.setAttribute('contenteditable', 'false');
		return shell; // no text content
	};

	function expectedWithWidgetsRemoved(source: string, nodes: InlineNode[]): string {
		const widgetRanges = nodes
			.filter((n) => n.kind === 'image' || n.kind === 'rawHtml')
			.map((n) => ({ start: n.start, end: n.end }));
		let out = '';
		let cursor = 0;
		for (const { start, end } of widgetRanges) {
			out += source.slice(cursor, start);
			cursor = end;
		}
		out += source.slice(cursor);
		return out;
	}

	it('image widget contributes 0; surrounding text remains', () => {
		const source = 'see ![alt](/x.png) end';
		const nodes = parseInline(source, 0, source.length);
		const container = document.createElement('div');
		container.appendChild(renderInlineNodes(nodes, source, { buildImageWidget }));
		expect(container.textContent).toBe(expectedWithWidgetsRemoved(source, nodes));
		expect(container.textContent).toBe('see  end');
	});

	it('<br> live widget contributes 0; surrounding text remains', () => {
		const source = 'a<br>b';
		const nodes = parseInline(source, 0, source.length);
		const container = document.createElement('div');
		container.appendChild(renderInlineNodes(nodes, source));
		expect(container.textContent).toBe(expectedWithWidgetsRemoved(source, nodes));
		expect(container.textContent).toBe('ab');
	});
});
