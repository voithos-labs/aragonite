import { describe, it, expect } from 'vitest';
import { parseInline } from '../../../core/inline';
import { trimTrailingPunctuation, isValidLeadingBoundary } from '../../../core/inline/links';
import { parse } from '../../../core/parser';
import { buildLinkReferenceMap } from '../../../core/inline/link-reference-resolver';

function inlineOf(rawContent: string) {
	return parseInline(rawContent, 0, rawContent.length);
}

function inlineWithRefs(content: string, refs: string) {
	const doc = parse(content + '\n\n' + refs);
	const map = buildLinkReferenceMap(doc.children);
	return parseInline(content, 0, content.length, map.resolve);
}

describe('parseInline — autolinks (Stage 3)', () => {
	it('angle-bracket autolink', () => {
		const nodes = inlineOf('Visit <https://example.com> now');
		expect(nodes[1].kind).toBe('autolink');
		expect(nodes[1].url).toBe('https://example.com');
	});

	it('bare URL autolink', () => {
		const nodes = inlineOf('Visit https://example.com now');
		expect(nodes[1].kind).toBe('autolink');
		expect(nodes[1].url).toBe('https://example.com');
	});

	it('non-URL angle brackets are not autolinks', () => {
		// `<world>` is no autolink (no URL/email pattern). After 0.6.7.1 it
		// matches the §6.10 inline HTML grammar as a type-7 open tag — that's
		// spec-correct and a separate concern from autolink detection.
		const nodes = inlineOf('Hello <world> end');
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('autolink still stops at entity boundary (regression guard for 1d44f0f)', () => {
		const nodes = inlineOf('see https://example.com/?a&amp;b end');
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('https://example.com/?a');
	});
});

describe('trimTrailingPunctuation (GFM §6.9)', () => {
	it('strips trailing period, comma, exclamation, question, colon, asterisk, underscore, tilde', () => {
		for (const punct of ['.', ',', '!', '?', ':', '*', '_', '~']) {
			const raw = `https://example.com${punct}`;
			expect(trimTrailingPunctuation(raw, 0, raw.length)).toBe('https://example.com'.length);
		}
	});

	it('strips multiple trailing punctuation chars in sequence', () => {
		const raw = 'https://example.com.,!';
		expect(trimTrailingPunctuation(raw, 0, raw.length)).toBe('https://example.com'.length);
	});

	it('keeps closing paren when matched by an earlier opening paren in the URL', () => {
		const raw = 'https://example.com/foo(bar)';
		expect(trimTrailingPunctuation(raw, 0, raw.length)).toBe(raw.length);
	});

	it('strips closing paren when there is no matching opening paren', () => {
		const raw = 'https://example.com)';
		expect(trimTrailingPunctuation(raw, 0, raw.length)).toBe('https://example.com'.length);
	});

	it('strips final semicolon when not preceded by HTML entity shape', () => {
		const raw = 'https://example.com;';
		expect(trimTrailingPunctuation(raw, 0, raw.length)).toBe('https://example.com'.length);
	});

	it('keeps final semicolon when preceded by HTML entity shape (&copy;)', () => {
		const raw = 'https://example.com/?a=&copy;';
		expect(trimTrailingPunctuation(raw, 0, raw.length)).toBe(raw.length);
	});

	it('keeps final semicolon when preceded by numeric entity (&#39;)', () => {
		const raw = 'https://example.com/?a=&#39;';
		expect(trimTrailingPunctuation(raw, 0, raw.length)).toBe(raw.length);
	});

	it('keeps final semicolon when preceded by hex entity (&#x27;)', () => {
		const raw = 'https://example.com/?a=&#x27;';
		expect(trimTrailingPunctuation(raw, 0, raw.length)).toBe(raw.length);
	});

	it('returns the input end when no trailing punctuation is present', () => {
		const raw = 'https://example.com/foo';
		expect(trimTrailingPunctuation(raw, 0, raw.length)).toBe(raw.length);
	});

	it('respects the urlStart bound when counting parens (offset case)', () => {
		const raw = 'see https://example.com/(a)';
		expect(trimTrailingPunctuation(raw, 4, raw.length)).toBe(raw.length);
	});
});

describe('isValidLeadingBoundary (GFM §6.9)', () => {
	it('true at start-of-region', () => {
		expect(isValidLeadingBoundary('https://x.com', 0, 0)).toBe(true);
	});

	it('true after whitespace', () => {
		expect(isValidLeadingBoundary('see https://x.com', 4, 0)).toBe(true);
	});

	it('true after open paren', () => {
		expect(isValidLeadingBoundary('(https://x.com)', 1, 0)).toBe(true);
	});

	it('true after emphasis markers (* _ ~)', () => {
		expect(isValidLeadingBoundary('*https://x.com', 1, 0)).toBe(true);
		expect(isValidLeadingBoundary('_https://x.com', 1, 0)).toBe(true);
		expect(isValidLeadingBoundary('~https://x.com', 1, 0)).toBe(true);
	});

	it('false when preceded by an alphanumeric char (mid-word)', () => {
		expect(isValidLeadingBoundary('xhttps://x.com', 1, 0)).toBe(false);
	});

	it('false when preceded by other non-boundary punctuation', () => {
		expect(isValidLeadingBoundary('a/https://x.com', 2, 0)).toBe(false);
	});
});

describe('bare http/https autolink — trim + boundary (GFM §6.9)', () => {
	it('strips trailing period at end of sentence', () => {
		const raw = 'Visit https://example.com.';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('https://example.com');
		expect(autolinks[0].end).toBe(raw.length - 1);
	});

	it('keeps trailing matched paren', () => {
		const raw = 'See https://en.wikipedia.org/wiki/Foo_(bar) here';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('https://en.wikipedia.org/wiki/Foo_(bar)');
	});

	it('strips trailing unmatched paren', () => {
		const raw = '(see https://example.com)';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('https://example.com');
	});

	it('autolink stops at named-entity boundary (&copy;)', () => {
		// Sibling regression of the 1d44f0f guard — the named entity (&copy;) form
		// exercises the same upstream-boundary path as the &amp; form above.
		const raw = 'foo https://example.com/?a=&copy; bar';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('https://example.com/?a=');
	});

	it('does not autolink mid-word', () => {
		const nodes = inlineOf('xhttps://example.com');
		expect(nodes.every((n) => n.kind === 'text')).toBe(true);
	});

	it('does autolink at start-of-region', () => {
		const nodes = inlineOf('https://example.com');
		expect(nodes[0].kind).toBe('autolink');
		expect(nodes[0].url).toBe('https://example.com');
	});

	it('does autolink after open paren', () => {
		const raw = '(https://example.com)';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('https://example.com');
	});
});

describe('bare www. autolink (GFM §6.9)', () => {
	it('autolinks www.example.com', () => {
		const raw = 'Visit www.example.com today';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('www.example.com');
	});

	it('autolinks WWW.EXAMPLE.COM (case insensitive prefix)', () => {
		const raw = 'See WWW.EXAMPLE.COM here';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('WWW.EXAMPLE.COM');
	});

	it('autolinks www. with path and query', () => {
		const raw = 'go to www.example.com/foo?a=1';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('www.example.com/foo?a=1');
	});

	it('does not autolink mid-word', () => {
		const nodes = inlineOf('xwww.example.com');
		expect(nodes.every((n) => n.kind === 'text')).toBe(true);
	});

	it('does not autolink lone "www" without dot', () => {
		const nodes = inlineOf('Visit www today');
		expect(nodes.every((n) => n.kind === 'text')).toBe(true);
	});

	it('does not autolink "www." with empty domain', () => {
		const nodes = inlineOf('Visit www. today');
		expect(nodes.every((n) => n.kind === 'text')).toBe(true);
	});

	it('strips trailing punctuation', () => {
		const raw = 'See www.example.com.';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('www.example.com');
	});
});

describe('bare email autolink (GFM §6.9)', () => {
	it('autolinks foo@bar.com at sentence position', () => {
		const raw = 'Email me at foo@bar.com please';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('mailto:foo@bar.com');
		expect(raw.slice(autolinks[0].start, autolinks[0].end)).toBe('foo@bar.com');
	});

	it('autolinks email at start-of-region', () => {
		const nodes = inlineOf('foo@bar.com');
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('mailto:foo@bar.com');
	});

	it('accepts dots, plus, underscore, hyphen in local part', () => {
		const raw = 'a.b+c_d-e@example.com';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('mailto:a.b+c_d-e@example.com');
	});

	it('accepts multi-segment domain', () => {
		const raw = 'foo@a.b.c.example.com';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('mailto:foo@a.b.c.example.com');
	});

	it('accepts hyphen inside domain segments', () => {
		const raw = 'foo@bar-baz.example.com';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('mailto:foo@bar-baz.example.com');
	});

	it('rejects email when last domain char is hyphen (GFM rule)', () => {
		const nodes = inlineOf('foo@bar-.com');
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('excludes trailing underscore from domain (GFM)', () => {
		const raw = 'foo@bar.com_';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('mailto:foo@bar.com');
		// Trailing _ is outside EMAIL_DOMAIN_CHAR; the segment scan halts at 'm'
		// and the underscore lands as text, same as a trailing whitespace.
	});

	it('rejects when an inner segment ends in hyphen', () => {
		// Inner-segment trailing dash exercises the in-loop break — distinct from
		// the first-segment dash check covered above.
		const raw = 'foo@bar.baz-';
		const nodes = inlineOf(raw);
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('rejects single-segment domain', () => {
		const nodes = inlineOf('foo@bar');
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('rejects when local-part preceded by non-boundary char', () => {
		// 'a/' supplies a leading '/' outside the boundary allow-list. The
		// local-part scan walks back to 'x', then isValidLeadingBoundary sees
		// '/' at the position before and rejects.
		const nodes = inlineOf('a/xfoo@bar.com');
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('rejects email with empty local-part', () => {
		const nodes = inlineOf('@bar.com');
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('rejects email-shaped string with two @ chars', () => {
		const nodes = inlineOf('foo@bar@example.com');
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('strips trailing period at sentence end', () => {
		const raw = 'Email me at foo@bar.com.';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('mailto:foo@bar.com');
	});
});

describe('angle-bracket email autolink (CommonMark §6.8)', () => {
	it('autolinks <foo@bar.com>', () => {
		const raw = 'contact <foo@bar.com> please';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('mailto:foo@bar.com');
	});

	it('start/end span includes the angle brackets', () => {
		const raw = '<foo@bar.com>';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].start).toBe(0);
		expect(autolinks[0].end).toBe(raw.length);
	});

	it('rejects <foo@bar> with single-segment domain', () => {
		const nodes = inlineOf('<foo@bar>');
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('rejects email with internal whitespace', () => {
		const nodes = inlineOf('<foo @bar.com>');
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('rejects empty local part', () => {
		const nodes = inlineOf('<@bar.com>');
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('rejects empty inner <>', () => {
		const nodes = inlineOf('see <> end');
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('rejects trailing dot in inner <foo@bar.>', () => {
		const nodes = inlineOf('<foo@bar.>');
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('rejects trailing hyphen in domain <foo@bar.com->', () => {
		// Pins the surviving last === '-' post-check; the regex would otherwise accept.
		const nodes = inlineOf('<foo@bar.com->');
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('still autolinks <https://...> URL form (regression)', () => {
		const nodes = inlineOf('<https://example.com>');
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('https://example.com');
	});
});

describe('autolink stage interactions', () => {
	it('autolink does not bleed into a following code span', () => {
		const raw = 'see https://example.com `code` end';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		const codeSpans = nodes.filter((n) => n.kind === 'inlineCode');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('https://example.com');
		expect(codeSpans).toHaveLength(1);
	});

	it('autolink does not start inside a code span', () => {
		// `https://x.com` is occupied as a code span before the autolink
		// scanner runs, so no autolink should be found inside it.
		const raw = 'pre `https://x.com` post';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		const codeSpans = nodes.filter((n) => n.kind === 'inlineCode');
		expect(autolinks).toHaveLength(0);
		expect(codeSpans).toHaveLength(1);
	});

	it('entity inside angle-bracket inner is not interpreted', () => {
		// The angle scanner regex-tests its sliced inner without re-invoking
		// the entity scanner, so &copy; here remains literal text inside the
		// failed-match angle pair (not a valid email or URL).
		const raw = 'see <foo&copy;bar> end';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(0);
		// The entity should still be recognized as a sibling of the angle text.
		const refs = nodes.filter((n) => n.kind === 'entityReference');
		expect(refs).toHaveLength(1);
		expect(refs[0].decoded).toBe('©');
	});
});

describe('reference-style link resolution (CommonMark §6.3)', () => {
	it('full reference: [text][label] resolves with url', () => {
		const nodes = inlineWithRefs('Click [here][go] now', '[go]: https://example.com');
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(1);
		expect(links[0].url).toBe('https://example.com');
		expect(links[0].label).toBe('go');
	});

	it('full reference: title from LRD is propagated', () => {
		const nodes = inlineWithRefs('[here][go]', '[go]: https://example.com "Go now"');
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links[0].title).toBe('Go now');
	});

	it('full reference: backslash-escaped bracket in the label resolves (CommonMark §4.7)', () => {
		// The LRD parser is escape-aware; the inline scanner must match it.
		const nodes = inlineWithRefs('[text][a\\]b]', '[a\\]b]: https://example.com');
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(1);
		expect(links[0].url).toBe('https://example.com');
	});

	it('full reference: text portion is parsed as inline children', () => {
		const nodes = inlineWithRefs('[**bold** text][go]', '[go]: https://example.com');
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links[0].children?.some((c) => c.kind === 'strong')).toBe(true);
	});

	it('collapsed reference: [label][] resolves using text as label', () => {
		const nodes = inlineWithRefs('See [foo][] today', '[foo]: https://example.com');
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(1);
		expect(links[0].url).toBe('https://example.com');
		expect(links[0].label).toBe('foo');
	});

	it('shortcut reference: [label] resolves using text as label', () => {
		const nodes = inlineWithRefs('See [foo] today', '[foo]: https://example.com');
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(1);
		expect(links[0].url).toBe('https://example.com');
	});

	it('case-insensitive label match', () => {
		const nodes = inlineWithRefs('[Click][GO]', '[go]: https://example.com');
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(1);
		expect(links[0].url).toBe('https://example.com');
	});

	it('whitespace-collapsing label match', () => {
		const nodes = inlineWithRefs('[Click][my  label]', '[my label]: https://example.com');
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(1);
		expect(links[0].url).toBe('https://example.com');
	});

	it('unresolved reference falls through to plain text (no link)', () => {
		const nodes = inlineWithRefs('[click][missing]', '[other]: https://example.com');
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(0);
	});

	it('inline form takes precedence over reference', () => {
		const nodes = inlineWithRefs('[click](https://other.com)', '[click]: https://ref.com');
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(1);
		expect(links[0].url).toBe('https://other.com');
	});

	it('reference brackets inside code spans do not resolve', () => {
		const nodes = inlineWithRefs('See `[click][go]` here', '[go]: https://example.com');
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(0);
	});

	it('no resolver passed: reference falls through (existing behavior preserved)', () => {
		const nodes = parseInline('[click][go]', 0, '[click][go]'.length);
		expect(nodes.every((n) => n.kind !== 'link')).toBe(true);
	});
});

describe('reference-style image resolution (CommonMark §6.3)', () => {
	it('full reference image: ![alt][label] resolves', () => {
		const nodes = inlineWithRefs('See ![pic][img] here', '[img]: /img.png');
		const images = nodes.filter((n) => n.kind === 'image');
		expect(images).toHaveLength(1);
		expect(images[0].url).toBe('/img.png');
		expect(images[0].alt).toBe('pic');
		expect(images[0].label).toBe('img');
	});

	it('collapsed reference image: ![alt][] resolves using alt as label', () => {
		const nodes = inlineWithRefs('![logo][]', '[logo]: /logo.png');
		const images = nodes.filter((n) => n.kind === 'image');
		expect(images).toHaveLength(1);
		expect(images[0].url).toBe('/logo.png');
		expect(images[0].alt).toBe('logo');
	});

	it('shortcut reference image: ![label] resolves', () => {
		const nodes = inlineWithRefs('![logo]', '[logo]: /logo.png');
		const images = nodes.filter((n) => n.kind === 'image');
		expect(images).toHaveLength(1);
		expect(images[0].url).toBe('/logo.png');
	});

	it('reference image with title from LRD', () => {
		const nodes = inlineWithRefs('![alt][img]', '[img]: /pic.png "Title"');
		const images = nodes.filter((n) => n.kind === 'image');
		expect(images[0].title).toBe('Title');
	});

	it('image dimension hint in alt text is parsed (0.6.4 behavior preserved)', () => {
		// `|100x50` dimension hint per 0.6.4 — the alt text is "logo|100x50" before
		// dimension-hint parsing strips the suffix
		const nodes = inlineWithRefs('![logo|100x50][img]', '[img]: /pic.png');
		const images = nodes.filter((n) => n.kind === 'image');
		expect(images).toHaveLength(1);
		expect(images[0].alt).toBe('logo');
		expect(images[0].width).toBe(100);
		expect(images[0].height).toBe(50);
	});

	it('unresolved reference image falls through to plain text', () => {
		const nodes = inlineWithRefs('![alt][missing]', '[other]: /img.png');
		const images = nodes.filter((n) => n.kind === 'image');
		expect(images).toHaveLength(0);
	});

	it('inline image form takes precedence over reference', () => {
		const nodes = inlineWithRefs('![alt](/inline.png)', '[alt]: /ref.png');
		const images = nodes.filter((n) => n.kind === 'image');
		expect(images).toHaveLength(1);
		expect(images[0].url).toBe('/inline.png');
	});

	it('image inside reference link: [![alt][img]][link] both resolve', () => {
		const source = '[![pic][img]][link]';
		const refs = '[img]: /pic.png\n[link]: https://example.com';
		const nodes = inlineWithRefs(source, refs);
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(1);
		expect(links[0].url).toBe('https://example.com');
		const innerImages = links[0].children?.filter((c) => c.kind === 'image');
		expect(innerImages).toHaveLength(1);
		expect(innerImages?.[0].url).toBe('/pic.png');
	});
});

describe('unresolvedReference emission (CommonMark §6.3 deviation)', () => {
	it('full reference link with no matching LRD emits unresolvedReference (refKind=link)', () => {
		const nodes = inlineWithRefs('[text][missing]', '[other]: https://example.com');
		const unresolved = nodes.filter((n) => n.kind === 'unresolvedReference');
		expect(unresolved).toHaveLength(1);
		expect(unresolved[0].refKind).toBe('link');
		expect(unresolved[0].label).toBe('missing');
	});

	it('collapsed reference link with no matching LRD emits unresolvedReference', () => {
		const nodes = inlineWithRefs('[missing][]', '[other]: https://example.com');
		const unresolved = nodes.filter((n) => n.kind === 'unresolvedReference');
		expect(unresolved).toHaveLength(1);
		expect(unresolved[0].refKind).toBe('link');
	});

	it('shortcut reference with no match still falls through to text (ambiguity)', () => {
		const nodes = inlineWithRefs('[just text]', '[other]: https://example.com');
		const unresolved = nodes.filter((n) => n.kind === 'unresolvedReference');
		expect(unresolved).toHaveLength(0);
	});

	it('full reference image with no matching LRD emits unresolvedReference (refKind=image)', () => {
		const nodes = inlineWithRefs('![alt][missing]', '[other]: /img.png');
		const unresolved = nodes.filter((n) => n.kind === 'unresolvedReference');
		expect(unresolved).toHaveLength(1);
		expect(unresolved[0].refKind).toBe('image');
	});

	it('collapsed reference image with no matching LRD emits unresolvedReference', () => {
		const nodes = inlineWithRefs('![missing][]', '[other]: /img.png');
		const unresolved = nodes.filter((n) => n.kind === 'unresolvedReference');
		expect(unresolved).toHaveLength(1);
		expect(unresolved[0].refKind).toBe('image');
	});

	it('resolved references do NOT emit unresolvedReference', () => {
		const nodes = inlineWithRefs('[text][foo]', '[foo]: https://example.com');
		const unresolved = nodes.filter((n) => n.kind === 'unresolvedReference');
		expect(unresolved).toHaveLength(0);
		expect(nodes.filter((n) => n.kind === 'link')).toHaveLength(1);
	});

	it('shortcut reference WITH match still resolves normally', () => {
		const nodes = inlineWithRefs('[foo]', '[foo]: https://example.com');
		const unresolved = nodes.filter((n) => n.kind === 'unresolvedReference');
		expect(unresolved).toHaveLength(0);
		expect(nodes.filter((n) => n.kind === 'link')).toHaveLength(1);
	});
});
