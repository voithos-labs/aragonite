import { describe, it, expect } from 'vitest';
import { parseInline } from '../../../core/inline';
import {
	trimTrailingPunctuation,
	isValidLeadingBoundary
} from '../../../core/inline/scan/autolinks';

function inlineOf(rawContent: string) {
	return parseInline(rawContent, 0, rawContent.length);
}

describe('parseInline — autolinks', () => {
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
		// `<world>` is no autolink (no URL/email pattern). It does match the §6.6 raw
		// HTML grammar as a type-7 open tag — spec-correct, and a separate concern
		// from autolink detection, so this asserts only the absence.
		const nodes = inlineOf('Hello <world> end');
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('autolink stops at entity boundary (&amp;)', () => {
		const nodes = inlineOf('see https://example.com/?a&amp;b end');
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('https://example.com/?a');
	});

	it('non-http scheme angle autolink (ftp)', () => {
		const nodes = inlineOf('Get <ftp://files.example.com/x> here');
		expect(nodes[1].kind).toBe('autolink');
		expect(nodes[1].url).toBe('ftp://files.example.com/x');
	});

	it('mailto scheme angle autolink keeps the scheme verbatim (no double prefix)', () => {
		const nodes = inlineOf('Mail <mailto:a@b.com> now');
		expect(nodes[1].kind).toBe('autolink');
		expect(nodes[1].url).toBe('mailto:a@b.com');
	});

	it('irc and custom (+.-) schemes autolink', () => {
		for (const uri of ['irc://chat.example.com', 'a+b-c.d://x']) {
			const nodes = inlineOf(`see <${uri}> end`);
			expect(nodes[1].kind).toBe('autolink');
			expect(nodes[1].url).toBe(uri);
		}
	});

	it('uppercase scheme autolinks', () => {
		const nodes = inlineOf('see <HTTPS://example.com> end');
		expect(nodes[1].kind).toBe('autolink');
		expect(nodes[1].url).toBe('HTTPS://example.com');
	});

	it('one-char scheme is not an autolink (min scheme length 2)', () => {
		const nodes = inlineOf('see <a:b> end');
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('whitespace in the body rejects the autolink', () => {
		const nodes = inlineOf('see <ftp://a b> end');
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('bare email angle autolink still works (mailto prefixed)', () => {
		const nodes = inlineOf('Mail <foo@bar.com> now');
		expect(nodes[1].kind).toBe('autolink');
		expect(nodes[1].url).toBe('mailto:foo@bar.com');
	});

	it('scheme autolink adjacent to inline raw-HTML does not fight over the brackets', () => {
		const nodes = inlineOf('<b>x</b> <ftp://h/p>');
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('ftp://h/p');
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

	it('keeps a trailing semicolon that does not resemble an entity reference', () => {
		// GFM §6.9: `;` is not trailing punctuation — a bare `;` stays in the url.
		const raw = 'https://example.com;';
		expect(trimTrailingPunctuation(raw, 0, raw.length)).toBe(raw.length);
	});

	it('excludes an entity-shaped tail (& + alphanumerics + ;), stripping back through the &', () => {
		// GFM §6.9 example 626: `&hl;` resembles an entity reference, so the whole
		// `&hl;` — the `&` and everything after — is excluded from the url.
		const raw = 'https://example.com/?q=&hl;';
		expect(trimTrailingPunctuation(raw, 0, raw.length)).toBe('https://example.com/?q='.length);
	});

	it('excludes an entity-shaped tail containing digits', () => {
		const raw = 'https://example.com/?q=&bogus08;';
		expect(trimTrailingPunctuation(raw, 0, raw.length)).toBe('https://example.com/?q='.length);
	});

	it('keeps a semicolon after an ampersand with no alphanumeric run (not entity-shaped)', () => {
		const raw = 'https://example.com/?a=&;';
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
		// Sibling of the &amp; case above: the named-entity form must halt the url at
		// the same upstream boundary, so a fix applied to one arm can't skip the other.
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
	it('autolinks www.example.com with the inserted http scheme', () => {
		const raw = 'Visit www.example.com today';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('http://www.example.com');
	});

	it('autolinks WWW.EXAMPLE.COM (case insensitive prefix)', () => {
		const raw = 'See WWW.EXAMPLE.COM here';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('http://WWW.EXAMPLE.COM');
	});

	it('autolinks www. with path and query', () => {
		const raw = 'go to www.example.com/foo?a=1';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('http://www.example.com/foo?a=1');
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
		expect(autolinks[0].url).toBe('http://www.example.com');
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

describe('angle-bracket email autolink (CommonMark §6.5)', () => {
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

	// No single-segment-domain rejection pin: §6.5's regex accepts `<foo@bar>`
	// (commonmark.js emits `mailto:foo@bar`); the accepting shape is pinned in
	// the scan suite.

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

describe('autolink interactions with other constructs', () => {
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

describe('parseInline — fast-bail output shape', () => {
	// Both cases pin the SHAPE of an output that contains an autolink, so both open
	// by asserting the autolink is there. Without that precondition neither can fail:
	// a degenerate single-text-node output has no adjacent pair to find, and it
	// reconstructs the raw bytes just as well as the real tiling does.
	it('fast path output has no adjacent text siblings', () => {
		const input = 'before  \nhttps://example.com after';
		const nodes = inlineOf(input);
		expect(nodes.some((n) => n.kind === 'autolink')).toBe(true);
		for (let i = 1; i < nodes.length; i++) {
			const prev = nodes[i - 1];
			const cur = nodes[i];
			if (cur.kind === 'text' && prev.kind === 'text') {
				throw new Error(
					`adjacent text nodes at indices ${i - 1}, ${i}: ${JSON.stringify([prev, cur])}`
				);
			}
		}
	});

	it('fast path: text+autolink+text reconstructs raw', () => {
		const input = 'pre https://example.com post';
		const nodes = inlineOf(input);
		expect(nodes.map((n) => n.kind)).toEqual(['text', 'autolink', 'text']);
		const reconstructed = nodes.map((n) => input.slice(n.start, n.end)).join('');
		expect(reconstructed).toBe(input);
	});
});

describe('parseInline — links and images', () => {
	it('simple inline link', () => {
		const nodes = inlineOf('Click [here](https://example.com) now');
		expect(nodes.length).toBe(3);
		expect(nodes[0]).toEqual({ kind: 'text', start: 0, end: 6, text: 'Click ' });
		expect(nodes[1].kind).toBe('link');
		expect(nodes[1].start).toBe(6);
		expect(nodes[1].end).toBe(33);
		expect(nodes[1].url).toBe('https://example.com');
		expect(nodes[1].children!.length).toBe(1);
		expect(nodes[1].children![0]).toEqual({ kind: 'text', start: 7, end: 11, text: 'here' });
	});

	it('link with title', () => {
		const nodes = inlineOf('[text](url "title")');
		expect(nodes[0].kind).toBe('link');
		expect(nodes[0].url).toBe('url');
		expect(nodes[0].title).toBe('title');
	});

	it('image', () => {
		const nodes = inlineOf('See ![alt text](image.png) here');
		expect(nodes[1].kind).toBe('image');
		expect(nodes[1].alt).toBe('alt text');
		expect(nodes[1].url).toBe('image.png');
	});

	describe('image inline parsing — dimensions', () => {
		it('extracts |N width from alt', () => {
			const raw = '![cat|400](https://example.com/cat.png)';
			const nodes = inlineOf(raw);
			expect(nodes).toHaveLength(1);
			const img = nodes[0];
			expect(img.kind).toBe('image');
			expect(img.alt).toBe('cat');
			expect(img.width).toBe(400);
			expect(img.height).toBeUndefined();
			expect(img.url).toBe('https://example.com/cat.png');
		});

		it('extracts |NxM width and height', () => {
			const raw = '![cat|400x300](https://example.com/cat.png)';
			const nodes = inlineOf(raw);
			const img = nodes[0];
			expect(img.alt).toBe('cat');
			expect(img.width).toBe(400);
			expect(img.height).toBe(300);
		});

		it('preserves source bytes regardless of dimension hint', () => {
			const raw = '![cat|400](https://example.com/cat.png)';
			const nodes = inlineOf(raw);
			expect(raw.slice(nodes[0].start, nodes[0].end)).toBe(raw);
		});

		it('treats invalid dimension hint as plain alt', () => {
			const raw = '![cat|0](https://example.com/cat.png)';
			const nodes = inlineOf(raw);
			expect(nodes[0].alt).toBe('cat|0');
			expect(nodes[0].width).toBeUndefined();
		});
	});

	it('link with emphasis in text', () => {
		const nodes = inlineOf('[**bold link**](url)');
		expect(nodes[0].kind).toBe('link');
		expect(nodes[0].children![0].kind).toBe('strong');
	});

	it('unmatched [ is plain text', () => {
		const nodes = inlineOf('Hello [world');
		expect(nodes).toEqual([{ kind: 'text', start: 0, end: 12, text: 'Hello [world' }]);
	});

	it('link without closing paren is plain text', () => {
		const nodes = inlineOf('[text](url');
		expect(nodes.every((n) => n.kind === 'text')).toBe(true);
	});
});

describe('parseInline — totality under deep bracket nesting', () => {
	// Totality is the pin here (the DoS guard), not tree shape: the §6.3
	// links-in-links deactivation shape is pinned in the scan suite.
	it('parses 2000-deep bracket nesting without throwing and covers all bytes', () => {
		const source = '['.repeat(2000) + 'a' + '](u)'.repeat(2000);
		const nodes = inlineOf(source);
		const reconstructed = nodes.map((n) => source.slice(n.start, n.end)).join('');
		expect(reconstructed).toBe(source);
	});
});
