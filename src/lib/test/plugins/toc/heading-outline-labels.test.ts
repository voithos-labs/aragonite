import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { computeInlineContent } from '$lib/core/inline';
import { __resetInlineSyntaxForTests } from '$lib/core/inline/scan/plugin-syntax';
import { __resetInlineWidgetsForTests } from '$lib/core/inline/inline-widgets';
import { __clearDeclaredPluginInlineKindsForTests } from '$lib/schema/plugin-kind';
import { registerEmoji } from '$lib/plugins/emoji/emoji-recognizer';
import { projectInlineText } from '$lib/plugins/toc/heading-outline';

// The label projection turns a heading's inline parse into clean display text: markers
// gone, links/images reduced to their text, value nodes shown as what they render to.
// `computeInlineContent` strips the `#` marker already, so this stage is content-only.
function label(src: string): string {
	const node = parse(src).children[0];
	return projectInlineText(computeInlineContent(node), node.raw);
}

describe('projectInlineText — clean heading labels', () => {
	const cases: Array<[string, string, string]> = [
		['drops emphasis markers', '# Plain *Bold* text\n', 'Plain Bold text'],
		['unwraps inline code', '# a `code` span\n', 'a code span'],
		['reduces a link to its text', '# see [text](http://x) here\n', 'see text here'],
		['reduces an image to its alt', '# a ![alt](img.png) pic\n', 'a alt pic'],
		['decodes an entity reference', '# fish &amp; chips\n', 'fish & chips'],
		['shows an autolink as its url', '# go <http://x.com> now\n', 'go http://x.com now'],
		['drops raw HTML tags, keeps their text', '# a <b>bold</b> tag\n', 'a bold tag']
	];
	for (const [name, src, expected] of cases) {
		it(name, () => expect(label(src)).toBe(expected));
	}
});

// The brief's mandated case: an emoji shortcode in a heading renders as its glyph,
// not its `:shortcode:` bytes — the "widget → rendered text" arm of the rule.
describe('projectInlineText — emoji glyph projection', () => {
	function resetInlineState(): void {
		__resetInlineSyntaxForTests();
		__resetInlineWidgetsForTests();
		__clearDeclaredPluginInlineKindsForTests();
	}
	beforeEach(resetInlineState);
	afterEach(resetInlineState);

	it('renders an emoji shortcode as its glyph when the emoji plugin is registered', () => {
		registerEmoji();
		expect(label('# Mood :smile: today\n')).toBe('Mood 😄 today');
	});

	it('falls back to source bytes for an unknown atomic widget kind', () => {
		// A widget node with no `decoded`/`text`/`children` and an unrecognized kind:
		// the documented fallback slices its source bytes from the parent raw.
		const raw = 'x[[??]]y';
		const nodes = [{ kind: 'mysteryWidget' as never, start: 1, end: 7 }];
		expect(projectInlineText(nodes, raw)).toBe('[[??]]');
	});
});
