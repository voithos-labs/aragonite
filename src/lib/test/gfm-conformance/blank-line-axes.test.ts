import { describe, expect, it } from 'vitest';
import { roundTripCases } from '#lib/test/support/round-trip.js';
import { editorOutline, referenceOutline } from './block-outline';

/**
 * A blank line holds only spaces and tabs (GFM §2.1), which shapes block structure on several
 * axes; each is pinned against commonmark.js, which the GFM extensions leave right for §2.1,
 * §4.4, §4.6, §5.1 and §5.2. Block outlines only: the reference's inline stage
 * `String.trim()`s a non-breaking space cmark-gfm keeps.
 */

const NBSP = String.fromCharCode(0xa0);

const AXES: { axis: string; source: string }[] = [
	{ axis: 'paragraph continuation', source: `a\n${NBSP}\nb\n` },
	{ axis: 'nbsp-only document', source: `${NBSP}\n` },
	{ axis: 'blockquote extent', source: `> a\n${NBSP}\n> b\n` },
	{ axis: 'list gap', source: `- a\n${NBSP}\n- b\n` },
	{ axis: 'indented-code reach', source: `    code1\n${NBSP}\n    code2\n` },
	{ axis: 'html-block termination', source: `<div>\n${NBSP}\n</div>\n` }
];

describe('a non-breaking space is content on every block axis', () => {
	it.each(AXES.map((a): [string, string] => [a.axis, a.source]))('%s', (_axis, source) => {
		expect(editorOutline(source)).toEqual(referenceOutline(source));
	});

	it('is not vacuous: the outline distinguishes the pre-narrowing structure', () => {
		expect(referenceOutline(`a\n${NBSP}\nb\n`)).toEqual(['paragraph']);
		expect(referenceOutline('a\n\nb\n')).toEqual(['paragraph', 'paragraph']);
	});
});

describe('blank-line axes round-trip byte-for-byte', () => {
	roundTripCases(AXES.map(({ axis, source }) => ({ name: axis, source })));
});
