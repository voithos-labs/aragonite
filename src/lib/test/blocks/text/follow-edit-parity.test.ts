// @vitest-environment jsdom
// G4.152: every anchor the editor renders resolves, by the lookup a click follows through, to a
// construct with an edit target in live mode. The samples are typed over every built-in kind.
// Miss-analysis: following read the DOM and editing read a policy flag only links had, and no test
// asked whether everything a click follows could be edited, so a bare URL had no Edit link.
import { describe, it, expect, afterEach } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { definitionsOf } from '#lib/core/inline/scan/definitions.js';
import { inlineDescendants } from '#lib/core/inline/index.js';
import { resolvedInlineContent } from '#lib/core/inline/inline-cache.js';
import type { InlineNodeKind } from '#lib/core/nodes.js';
import { createTextRender } from '#lib/components/blocks/text/text-render.js';
import { followTargetAt, followedConstructAt } from '#lib/components/blocks/text/link-at-point.js';
import { rawOffsetAt } from '#lib/browser/offsets.js';
import { makeRenderHarness } from '#lib/test/harness/text-render.js';
import { fixtureReading } from '../../harness/fixture-grammar';

/** One paragraph holding the kind, its definitions after it where it needs one. */
const SAMPLES: Record<InlineNodeKind, string> = {
	text: 'plain words\n',
	emphasis: 'an *emphasised* word\n',
	strong: 'a **strong** word\n',
	strikethrough: 'a ~~struck~~ word\n',
	inlineCode: 'a `code` span\n',
	link: 'a [link](https://example.com/) here\n',
	image: 'an ![alt](https://example.com/p.png) here\n',
	autolink: 'visit https://example.com/bare today\n',
	hardLineBreak: 'line one  \nline two\n',
	escape: 'an \\* escape\n',
	entityReference: 'an &amp; entity\n',
	unresolvedReference: 'a [ref][missing] here\n',
	rawHtml: 'some <a href="https://example.com/">raw</a> html\n'
};

/** The other shapes a kind renders an anchor in. */
const SHAPES: [string, InlineNodeKind, string][] = [
	['an angle autolink', 'autolink', 'see <https://example.com/angle> here\n'],
	['an email autolink', 'autolink', 'mail someone@example.com today\n'],
	['a reference link', 'link', 'see [docs][ref] here\n\n[ref]: https://example.com/d\n'],
	['a link around an image', 'link', '[![alt](https://example.com/p.png)](https://example.com/)\n']
];

function mountLive(source: string) {
	const doc = parse(source);
	const node = doc.children[0];
	const map = definitionsOf(doc.children);
	const reading = fixtureReading(
		{ resolver: map.resolve, resolverSignature: map.signature },
		'live'
	);
	const harness = makeRenderHarness(node, {
		mode: 'live',
		reading: { resolver: map.resolve, resolverSignature: map.signature, resolverEpoch: 1 }
	});
	createTextRender(harness.deps).render();
	return { el: harness.el, node, reading };
}

afterEach(() => document.body.replaceChildren());

const ROWS: [string, InlineNodeKind, string][] = [
	...(Object.entries(SAMPLES) as [InlineNodeKind, string][]).map(
		([kind, source]): [string, InlineNodeKind, string] => [kind, kind, source]
	),
	...SHAPES
];

describe('everything a click follows can be edited (G4.152)', () => {
	it.each(ROWS)('%s', (_name, kind, source) => {
		const { el, node, reading } = mountLive(source);
		const kinds = [...inlineDescendants(resolvedInlineContent(node, reading))].map((n) => n.kind);
		expect(kinds, 'the sample holds its kind').toContain(kind);
		for (const anchor of el.querySelectorAll('a[href]')) {
			const offset = rawOffsetAt(el, anchor, 0);
			const shown = anchor.outerHTML;
			expect(followedConstructAt(node, offset, reading), `${shown} follows`).not.toBeNull();
			expect(followTargetAt(node, offset, reading), `${shown} has an edit`).not.toBeNull();
		}
	});
});
