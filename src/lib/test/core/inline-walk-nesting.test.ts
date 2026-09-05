// @vitest-environment jsdom
// Miss-analysis: the depth pins stopped at the renderer and the offset walk
// (`inline-render-nesting.test.ts`) and never followed their output one call further, so every
// walk over a rendered fragment or a parsed inline tree recursed per level, unpinned.
import { afterEach, describe, expect, it } from 'vitest';
import type { CstNode, InlineNode } from '../../core/nodes';
import { parse, MAX_NESTING_DEPTH } from '../../core/parser';
import { inlineDescendants, parseInline } from '../../core/inline';
import { flattenInlineWidgets } from '../../core/inline/inline-widgets';
import { buildLinkReferenceMap } from '../../core/inline/link-reference-resolver';
import { CONTENT_VISIBILITY, visibleRuns, renderedText } from '../../core/inline/visibility';
import {
	__resetInlineSyntaxForTests,
	registerInlineSyntax
} from '../../core/inline/scan/plugin-syntax';

afterEach(() => __resetInlineSyntaxForTests());

// Both constants assume the default V8 stack; raising `--stack-size` turns these pins green
// against a recursive walk.
const MODEL_DEPTH = 32_000;
// jsdom's insert bookkeeping is superlinear in tree depth (a native DOM is not), so the
// environment, not the walk, caps the one pin that renders. The margin is thin — a recursive
// twin overflows a few thousand levels below this — so a roomier stack greens the pin.
const RENDER_DEPTH = 8_000;

/**
 * A `strong` chain around `leaf`, over the `**`-run source it parses from. Built rather than
 * parsed: the parse is quadratic in the delimiter run and the walks are the subject here.
 */
function nestedStrong(
	depth: number,
	leaf: (start: number, end: number) => InlineNode
): { nodes: InlineNode[]; raw: string } {
	const raw = '**'.repeat(depth) + 'ab' + '**'.repeat(depth);
	let node = leaf(2 * depth, 2 * depth + 2);
	for (let level = depth - 1; level >= 0; level--) {
		node = { kind: 'strong', start: 2 * level, end: raw.length - 2 * level, children: [node] };
	}
	return { nodes: [node], raw };
}

const textLeaf = (start: number, end: number): InlineNode => ({
	kind: 'text',
	start,
	end,
	text: 'ab'
});

describe('inline tree walks at input-controlled nesting depth', () => {
	it('yields a declined node without its children', () => {
		const { nodes } = nestedStrong(3, textLeaf);
		const starts = [...inlineDescendants(nodes, (node) => node.start !== 2)].map((n) => n.start);
		expect(starts).toEqual([0, 2]);
	});

	it('walks a construct chain past the recursion ceiling, in source order', () => {
		const { nodes } = nestedStrong(MODEL_DEPTH, textLeaf);
		const starts = [...inlineDescendants(nodes)].map((node) => node.start);

		expect(starts).toHaveLength(MODEL_DEPTH + 1);
		expect(starts.findIndex((start, level) => start !== 2 * level)).toBe(-1);
	});

	it('flattens widgets past the recursion ceiling, in document order', () => {
		const { nodes, raw } = nestedStrong(MODEL_DEPTH, (start, end) => ({
			kind: 'image',
			start,
			end,
			alt: '',
			url: 'u'
		}));
		const trailing: InlineNode = { kind: 'image', start: raw.length, end: raw.length, url: 'u' };

		expect(flattenInlineWidgets([...nodes, trailing], raw).map((n) => n.start)).toEqual([
			2 * MODEL_DEPTH,
			raw.length
		]);
	});

	// A recognizer may mint any tree, so a rung's claim stamp inherits the depth its author chose.
	it('stamps a rung-minted chain past the recursion ceiling', () => {
		const raw = 'Q' + 'x'.repeat(2 * MODEL_DEPTH + 2);
		registerInlineSyntax('Q', (_source, pos, end) => {
			let node: InlineNode = { kind: 'text', start: pos + MODEL_DEPTH, end: end - MODEL_DEPTH };
			for (let level = MODEL_DEPTH - 1; level >= 0; level--) {
				node = { kind: 'strong', start: pos + level, end: end - level, children: [node] };
			}
			return node;
		});

		const claimed = parseInline(raw, 0, raw.length);
		let deepest = claimed[0];
		while (deepest.children?.[0]) deepest = deepest.children[0];

		expect(deepest.syntaxClaim).toMatchObject({ prefix: 'Q' });
		// Membership, not just reach: every node of the chain carries the claim.
		const stamped = [...inlineDescendants(claimed)].filter((node) => node.syntaxClaim);
		expect(stamped).toHaveLength(MODEL_DEPTH + 1);
	});

	// Block nesting is capped where inline nesting is not, so the deepest tree the parser will
	// build is this walk's whole range — the pin is that the cap and the walk stay paired.
	it('resolves a reference defined at the deepest container the parser builds', () => {
		const source = '>'.repeat(MAX_NESTING_DEPTH - 1) + ' [a]: /u\n';
		const doc = parse(source, { scope: 'document' });

		expect(buildLinkReferenceMap(doc.children as CstNode[]).resolve('a')).toEqual({ url: '/u' });
	});

	// `renderedText` is this walk's visible fold, so the deep pin below carries it.
	it('reads the visible text as the fold of its runs', () => {
		const raw = '**ab**';
		const { nodes } = nestedStrong(1, textLeaf);
		const visible = visibleRuns(nodes, raw, CONTENT_VISIBILITY)
			.filter((run) => run.visible)
			.map((run) => run.text)
			.join('');

		expect(visible).toBe('ab');
		expect(renderedText(nodes, raw, CONTENT_VISIBILITY)).toBe(visible);
	});

	it('tiles the rendered source in order past the recursion ceiling', () => {
		const { nodes, raw } = nestedStrong(RENDER_DEPTH, textLeaf);
		const runs = visibleRuns(nodes, raw, CONTENT_VISIBILITY);

		expect(runs[0].start).toBe(0);
		expect(runs[runs.length - 1].end).toBe(raw.length);
		expect(runs.findIndex((run, i) => i > 0 && run.start !== runs[i - 1].end)).toBe(-1);
		expect(
			runs
				.filter((run) => run.visible)
				.map((run) => run.text)
				.join('')
		).toBe('ab');
	}, 600_000);
});
