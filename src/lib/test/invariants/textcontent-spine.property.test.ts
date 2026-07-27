// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { InlineNode } from '../../core/nodes';
import { parseInline } from '../../core/inline';
import { renderInlineNodes } from '../../core/inline-render';
import { buildAmbientSpan } from '../../ambient/ambient-dom';
import { rawTextOfNode } from '../../cursor/widget-offset';
import type { IndexedDecoration } from '../../decorations/buckets';
import { applyIslandDecorations } from '../../decorations/island-dom';
import type { ReplaceDecoration, WidgetDecoration } from '../../decorations/types';
import { mountDecorationWidget } from '../../decorations/widget-dom';
import { arbAltOnlyImage, arbInlineSource, freshOrFixedSeed } from './arbitraries';

// G2.4: the rendered DOM's textContent reproduces the source bytes. Every char
// in raw maps to a DOM text node so caret <-> offset round-trips; markers render
// as dimmed spans whose text still counts. The widget-free corpus excludes
// images and `<br>` (atomic widgets that contribute 0 textContent), so the
// invariant is the clean `textContent === source`. The widget-delta case below
// supplies widgets explicitly and accounts for their zero contribution.

const PARAMS = { numRuns: 1000, seed: freshOrFixedSeed(424242) } as const;

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

	// Pinned counterexample: a link destination terminating inside a code span
	// once duplicated the straddled bytes in the rendered spine.
	it('link destination ending inside a code span renders byte-exact', () => {
		const source = '[a](u`)`)';
		const nodes = parseInline(source, 0, source.length);
		const container = renderToContainer(nodes, source);
		expect(container.textContent).toBe(source);
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

	it('a visible entity widget shows its glyph but the walk reads back its bytes', () => {
		const source = 'a&copy;b';
		const nodes = parseInline(source, 0, source.length);
		const container = document.createElement('div');
		container.appendChild(renderInlineNodes(nodes, source));
		// The DOM textContent is the glyph (the widget contributes its `©`, not `&copy;`);
		// the raw-aware walk recovers the source bytes from data-source-*.
		expect(container.textContent).toBe('a©b');
		expect(rawTextOfNode(container, source)).toBe(source);
	});

	it('an invisible entity keeps its literal span, so textContent equals raw', () => {
		const source = 'a&nbsp;b';
		const nodes = parseInline(source, 0, source.length);
		const container = document.createElement('div');
		container.appendChild(renderInlineNodes(nodes, source));
		expect(container.querySelector('[data-inline-widget]')).toBeNull();
		expect(container.textContent).toBe(source);
	});
});

// A kind that declines image widgets (a table cell) renders an image INTO the
// spine, so its bytes are the invariant rather than a widget delta. The nodes are
// minted, not parsed: a rung may derive an alt from anywhere, while a parsed alt is
// always a slice of its own label — so this is the only corpus that can state the
// rule the render path actually needs.
describe('G2.4 textContent spine (alt-only images)', () => {
	it('a minted image renders its own bytes, whatever its alt says', () => {
		fc.assert(
			fc.property(arbAltOnlyImage, ({ raw, node }) => {
				const nodes: InlineNode[] = [];
				if (node.start > 0) nodes.push({ kind: 'text', start: 0, end: node.start });
				nodes.push(node);
				if (node.end < raw.length) nodes.push({ kind: 'text', start: node.end, end: raw.length });
				const container = document.createElement('div');
				container.appendChild(renderInlineNodes(nodes, raw, { renderImagesAsWidgets: false }));
				expect(container.textContent).toBe(raw);
			}),
			PARAMS
		);
	});
});

// Decoration islands are atomic widgets too: a widget island spans 0 bytes, a
// replace island's data-source span carries the bytes it displaced. The spine
// invariant generalizes — for any placement of N islands the walk-summed raw
// (text nodes + data-source spans) still reproduces the source. Multiple
// overlapping replaces push `orderForApplication`'s descending pass past its
// two-island floor and land a later boundary strictly inside an earlier replace
// island, which is where end-snap fires. Boundaries inside markers, code spans,
// links, and mid-astral-pair are all in reach of the corpus.
//
// Start-snap (a boundary inside a *nonzero-span* atomic widget) is NOT reachable
// here: the descending pass never leaves such a widget before a later boundary,
// and the corpus emits no images / `<br>`. Its sole guard is the atomic-widget
// unit in `decorations/island-dom.test.ts` — do not fold it into this property.
describe('G2.4 textContent spine (decoration islands)', () => {
	const opts = { mountWidget: mountDecorationWidget };

	type IslandSpec = { kind: 'widget'; at: number } | { kind: 'replace'; a: number; b: number };

	const arbIslandSpec: fc.Arbitrary<IslandSpec> = fc.oneof(
		{
			weight: 3,
			arbitrary: fc.record({ kind: fc.constant('replace' as const), a: fc.nat(), b: fc.nat() })
		},
		{ weight: 1, arbitrary: fc.record({ kind: fc.constant('widget' as const), at: fc.nat() }) }
	);
	const arbIslandSpecs = fc.array(arbIslandSpec, { minLength: 1, maxLength: 6 });

	function toIslands(
		specs: IslandSpec[],
		contentLength: number
	): IndexedDecoration<WidgetDecoration | ReplaceDecoration>[] {
		const clamp = (n: number) => n % (contentLength + 1);
		return specs.map((spec, index) => {
			if (spec.kind === 'widget') {
				const dec: WidgetDecoration = {
					type: 'widget',
					path: [0],
					offset: clamp(spec.at),
					widget: { buildDom: () => document.createElement('span') }
				};
				return { index, dec };
			}
			const lo = clamp(spec.a);
			const hi = clamp(spec.b);
			const dec: ReplaceDecoration = {
				type: 'replace',
				path: [0],
				start: Math.min(lo, hi),
				end: Math.max(lo, hi)
			};
			return { index, dec };
		});
	}

	// Apply the island set to a fresh render, optionally behind an ambient prefix
	// whose bytes are NOT part of raw, and return the walk-summed raw of the
	// content — every child after the ambient span.
	function readBackAfterIslands(source: string, specs: IslandSpec[], prefix?: string): string {
		const container = document.createElement('div');
		if (prefix !== undefined) container.appendChild(buildAmbientSpan(prefix));
		container.appendChild(renderInlineNodes(parseInline(source, 0, source.length), source));
		applyIslandDecorations(container, source, toIslands(specs, source.length), {
			...opts,
			ambientLength: prefix?.length ?? 0
		});
		if (prefix === undefined) return rawTextOfNode(container, source);
		let out = '';
		for (const child of Array.from(container.childNodes)) {
			if (child !== container.firstChild) out += rawTextOfNode(child, source);
		}
		return out;
	}

	// Later boundary lands inside an earlier replace island — deterministic pins
	// that end-snap regardless of seed drift (the last chains three deep).
	const overlapExamples: [string, IslandSpec[]][] = [
		[
			'abcdef',
			[
				{ kind: 'replace', a: 0, b: 4 },
				{ kind: 'replace', a: 2, b: 6 }
			]
		],
		[
			'abcdef',
			[
				{ kind: 'replace', a: 1, b: 5 },
				{ kind: 'replace', a: 3, b: 6 },
				{ kind: 'replace', a: 0, b: 4 }
			]
		]
	];

	it('arbitrary widget + replace islands keep the walk-summed raw byte-exact', () => {
		fc.assert(
			fc.property(arbInlineSource, arbIslandSpecs, (source, specs) => {
				expect(readBackAfterIslands(source, specs)).toBe(source);
			}),
			{ ...PARAMS, examples: overlapExamples }
		);
	});

	it('the same fuzz behind an ambient prefix keeps the content spine byte-exact', () => {
		fc.assert(
			fc.property(
				fc.constantFrom('## ', '- ', '> ', '1. '),
				arbInlineSource,
				arbIslandSpecs,
				(prefix, source, specs) => {
					expect(readBackAfterIslands(source, specs, prefix)).toBe(source);
				}
			),
			PARAMS
		);
	});
});
