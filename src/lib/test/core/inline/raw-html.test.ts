import { describe, it, expect } from 'vitest';
import { parseInline } from '../../../core/inline';

function inlineOf(rawContent: string) {
	return parseInline(rawContent, 0, rawContent.length);
}

describe('parseInline — raw HTML per-form detection', () => {
	it('detects inline <br> as rawHtml', () => {
		const nodes = inlineOf('foo<br>bar');
		const html = nodes.filter((n) => n.kind === 'rawHtml');
		expect(html).toHaveLength(1);
		expect(html[0].start).toBe(3);
		expect(html[0].end).toBe(7);
	});

	it('detects open tag with attributes', () => {
		const raw = 'see <span class="hl">x</span> here';
		const nodes = inlineOf(raw);
		const html = nodes.filter((n) => n.kind === 'rawHtml');
		expect(html).toHaveLength(2);
		expect(raw.slice(html[0].start, html[0].end)).toBe('<span class="hl">');
		expect(raw.slice(html[1].start, html[1].end)).toBe('</span>');
	});

	it('detects self-closing tag <br/>', () => {
		const nodes = inlineOf('one<br/>two');
		const html = nodes.filter((n) => n.kind === 'rawHtml');
		expect(html).toHaveLength(1);
	});

	it('detects multi-line tag (attribute on next line)', () => {
		const raw = 'x<span\nclass="y">x</span>';
		const nodes = inlineOf(raw);
		const html = nodes.filter((n) => n.kind === 'rawHtml');
		expect(html).toHaveLength(2);
	});

	it('detects inline comment', () => {
		const raw = 'x <!-- hi --> y';
		const nodes = inlineOf(raw);
		const html = nodes.filter((n) => n.kind === 'rawHtml');
		expect(html).toHaveLength(1);
		expect(raw.slice(html[0].start, html[0].end)).toBe('<!-- hi -->');
	});

	it('detects CDATA', () => {
		const raw = 'x <![CDATA[ data ]]> y';
		const nodes = inlineOf(raw);
		const html = nodes.filter((n) => n.kind === 'rawHtml');
		expect(html).toHaveLength(1);
	});

	it('detects declaration', () => {
		const raw = 'x <!ENTITY foo "bar"> y';
		const nodes = inlineOf(raw);
		const html = nodes.filter((n) => n.kind === 'rawHtml');
		expect(html).toHaveLength(1);
	});

	it('detects processing instruction', () => {
		const raw = 'x <?xml version="1.0"?> y';
		const nodes = inlineOf(raw);
		const html = nodes.filter((n) => n.kind === 'rawHtml');
		expect(html).toHaveLength(1);
	});

	it('unterminated open tag falls through to text (no rawHtml)', () => {
		const nodes = inlineOf('foo<span no end');
		const html = nodes.filter((n) => n.kind === 'rawHtml');
		expect(html).toHaveLength(0);
	});
});

describe('parseInline — raw HTML composition with other constructs', () => {
	it('HTML inside code span stays inert (code span claims first)', () => {
		const nodes = inlineOf('see `<br>` here');
		const html = nodes.filter((n) => n.kind === 'rawHtml');
		const code = nodes.filter((n) => n.kind === 'inlineCode');
		expect(html).toHaveLength(0);
		expect(code).toHaveLength(1);
	});

	it('escaped < does not start HTML (\\<br> stays as escape+text)', () => {
		const nodes = inlineOf('foo \\<br> bar');
		const html = nodes.filter((n) => n.kind === 'rawHtml');
		expect(html).toHaveLength(0);
	});

	it('autolink wins for <https://example.com> (more specific)', () => {
		const nodes = inlineOf('see <https://example.com> here');
		const html = nodes.filter((n) => n.kind === 'rawHtml');
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(html).toHaveLength(0);
		expect(autolinks).toHaveLength(1);
	});

	it('entity reference stays as entity, not HTML (&lt;br&gt; is entities)', () => {
		const nodes = inlineOf('foo &lt;br&gt; bar');
		const html = nodes.filter((n) => n.kind === 'rawHtml');
		const ents = nodes.filter((n) => n.kind === 'entityReference');
		expect(html).toHaveLength(0);
		expect(ents).toHaveLength(2);
	});

	it('* inside HTML attribute does NOT start emphasis', () => {
		const nodes = inlineOf('<span class="*foo*">x</span>');
		const html = nodes.filter((n) => n.kind === 'rawHtml');
		const emph = nodes.filter((n) => n.kind === 'emphasis');
		expect(html).toHaveLength(2);
		expect(emph).toHaveLength(0);
	});

	it('two adjacent HTML tags both detected', () => {
		const nodes = inlineOf('<br><br>');
		const html = nodes.filter((n) => n.kind === 'rawHtml');
		expect(html).toHaveLength(2);
	});

	it('lone < stays as text', () => {
		const nodes = inlineOf('a < b');
		const html = nodes.filter((n) => n.kind === 'rawHtml');
		expect(html).toHaveLength(0);
	});
});
