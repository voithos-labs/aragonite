// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import type { InlineNode } from '../../core/nodes';
import { contentLengthOf, parseInline } from '../../core/inline';
import { renderInlineNodes } from '../../core/inline-render';
import { buildAmbientSpan } from '../../ambient/ambient-dom';
import { rawTextOfNode } from '../../cursor/widget-offset';
import type { IndexedDecoration } from '../../decorations/buckets';
import { applyIslandDecorations } from '../../decorations/island-dom';
import type { ReplaceDecoration, WidgetDecoration } from '../../decorations/types';
import { mountDecorationWidget } from '../../decorations/widget-dom';
import { arbAltOnlyImage, arbInlineSource, freshOrFixedSeed } from './arbitraries';
import { allowDevWarns } from '$lib/test/support/warn-gate';
import { renderOptions } from '../harness/fixture-grammar';

// Arbitrary replace spans land inside atomic widgets, and snapping outward is the behaviour under
// test.
afterEach(() => allowDevWarns(['decorations']));

// G2.4: the rendered DOM's textContent reproduces the source bytes, so caret <-> offset
// round-trips. The widget-free corpus excludes images and `<br>`, whose zero contribution
// the widget-delta case below accounts for explicitly.

const PARAMS = { numRuns: 1000, seed: freshOrFixedSeed(424242) } as const;

function renderToContainer(
	nodes: InlineNode[],
	raw: string,
	options: Parameters<typeof renderInlineNodes>[2] = renderOptions()
): HTMLElement {
	const container = document.createElement('div');
	container.appendChild(renderInlineNodes(nodes, raw, options));
	return container;
}

describe('G2.4 textContent chain (widget-free)', () => {
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

	it('ambient prefix prepends exactly its text to the chain', () => {
		fc.assert(
			fc.property(fc.constantFrom('## ', '- ', '> ', '1. '), arbInlineSource, (prefix, content) => {
				const nodes = parseInline(content, 0, content.length);
				const container = document.createElement('div');
				container.appendChild(buildAmbientSpan(prefix));
				container.appendChild(renderInlineNodes(nodes, content, renderOptions()));
				expect(container.textContent).toBe(prefix + content);
			}),
			PARAMS
		);
	});

	// A pinned counterexample: a destination ending inside a code span duplicated the straddled
	// bytes in the rendered text.
	it('link destination ending inside a code span renders byte-exact', () => {
		const source = '[a](u`)`)';
		const nodes = parseInline(source, 0, source.length);
		const container = renderToContainer(nodes, source);
		expect(container.textContent).toBe(source);
	});

	// The rendered text cannot tell which pair a shared delimiter run binds to, so the four
	// spellings drawn at random get a deterministic minimum of their own.
	it.each(['*a *b* c*', '**a **b** c**', '**a *b** c*', '*a **b* c**'])(
		'asterisk delimiter nesting renders byte-exact: %s',
		(source) => {
			const nodes = parseInline(source, 0, source.length);
			expect(renderToContainer(nodes, source).textContent).toBe(source);
		}
	);
});

// An atomic widget contributes no textContent, because its bytes live in `data-source-*`
// attributes, so the expected text is the source with each widget's byte range removed.
describe('G2.4 textContent chain (atomic-widget delta)', () => {
	const buildImageWidget = (): Node => {
		const shell = document.createElement('span');
		shell.dataset.inlineWidget = '';
		shell.setAttribute('contenteditable', 'false');
		return shell;
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
		const container = renderToContainer(nodes, source, renderOptions({ buildImageWidget }));
		expect(container.textContent).toBe(expectedWithWidgetsRemoved(source, nodes));
		expect(container.textContent).toBe('see  end');
	});

	it('<br> live widget contributes 0; surrounding text remains', () => {
		const source = 'a<br>b';
		const nodes = parseInline(source, 0, source.length);
		const container = renderToContainer(nodes, source);
		expect(container.textContent).toBe(expectedWithWidgetsRemoved(source, nodes));
		expect(container.textContent).toBe('ab');
	});

	it('a visible entity widget shows its glyph but the walk reads back its bytes', () => {
		const source = 'a&copy;b';
		const nodes = parseInline(source, 0, source.length);
		const container = renderToContainer(nodes, source);
		// The widget contributes its glyph, so only the raw-aware traversal recovers the bytes.
		expect(container.textContent).toBe('a©b');
		expect(rawTextOfNode(container, source)).toBe(source);
	});

	it('an invisible entity keeps its literal span, so textContent equals raw', () => {
		const source = 'a&nbsp;b';
		const nodes = parseInline(source, 0, source.length);
		const container = renderToContainer(nodes, source);
		expect(container.querySelector('[data-inline-widget]')).toBeNull();
		expect(container.textContent).toBe(source);
	});
});

// A kind that declines image widgets renders the image into the text, so its bytes are the rule
// rather than a subtraction. Built by hand, not parsed: a plugin's inline handler may derive an
// alt from anywhere, so no parsed corpus can state the rule the render path needs.
describe('G2.4 textContent chain (alt-only images)', () => {
	it('a created image renders its own bytes, whatever its alt says', () => {
		fc.assert(
			fc.property(arbAltOnlyImage, ({ raw, node }) => {
				const nodes: InlineNode[] = [];
				if (node.start > 0) nodes.push({ kind: 'text', start: 0, end: node.start });
				nodes.push(node);
				if (node.end < raw.length) nodes.push({ kind: 'text', start: node.end, end: raw.length });
				const container = renderToContainer(
					nodes,
					raw,
					renderOptions({ renderImagesAsWidgets: false })
				);
				expect(container.textContent).toBe(raw);
			}),
			PARAMS
		);
	});
});

// The rule holds for any number of inline widgets: whatever their placement, the raw summed over
// the traversal still reproduces the source. Overlapping replaces are what push the descending
// pass past two widgets into snapping at the end.
//
// Snapping at the start (a boundary inside an atomic widget that spans bytes) is unreachable here,
// because the corpus emits no images or `<br>`. `decorations/island-dom.test.ts` is its only
// check; do not merge it into this property.
describe('G2.4 textContent chain (decoration widgets)', () => {
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

	// The container's marker prefix is not part of raw, so the read-back skips it.
	function readBackAfterIslands(source: string, specs: IslandSpec[], prefix?: string): string {
		const container = document.createElement('div');
		if (prefix !== undefined) container.appendChild(buildAmbientSpan(prefix));
		container.appendChild(
			renderInlineNodes(parseInline(source, 0, source.length), source, renderOptions())
		);
		const contentLength = contentLengthOf({ kind: 'paragraph', leadingTrivia: '', raw: source });
		applyIslandDecorations(container, source, toIslands(specs, contentLength), {
			...opts,
			contentLength
		});
		if (prefix === undefined) return rawTextOfNode(container, source);
		let out = '';
		for (const child of Array.from(container.childNodes)) {
			if (child !== container.firstChild) out += rawTextOfNode(child, source);
		}
		return out;
	}

	// Deterministic cases that snap at the end whatever the seed: a later boundary lands inside
	// an earlier replace widget.
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

	it('arbitrary widget + replace decorations keep the walk-summed raw byte-exact', () => {
		fc.assert(
			fc.property(arbInlineSource, arbIslandSpecs, (source, specs) => {
				expect(readBackAfterIslands(source, specs)).toBe(source);
			}),
			{ ...PARAMS, examples: overlapExamples }
		);
	});

	it('the same fuzz behind an ambient prefix keeps the content chain byte-exact', () => {
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
		// ~2s alone; the full battery's worker saturation blows the default 5s cap.
	}, 20_000);
});
