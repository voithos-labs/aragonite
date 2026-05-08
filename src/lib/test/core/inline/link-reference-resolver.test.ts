import { describe, it, expect } from 'vitest';
import {
	buildLinkReferenceMap,
	normalizeLinkLabel
} from '../../../core/inline/link-reference-resolver';
import { parse } from '../../../core/parser';

describe('normalizeLinkLabel (CommonMark §4.7)', () => {
	it('lowercases ASCII letters', () => {
		expect(normalizeLinkLabel('FOO')).toBe('foo');
		expect(normalizeLinkLabel('Foo Bar')).toBe('foo bar');
	});

	it('strips leading and trailing whitespace', () => {
		expect(normalizeLinkLabel('  foo  ')).toBe('foo');
		expect(normalizeLinkLabel('\tfoo\n')).toBe('foo');
	});

	it('collapses internal whitespace runs to a single space', () => {
		expect(normalizeLinkLabel('foo  bar')).toBe('foo bar');
		expect(normalizeLinkLabel('foo\t\tbar')).toBe('foo bar');
		expect(normalizeLinkLabel('foo \t \n bar')).toBe('foo bar');
	});

	it('combines all transforms', () => {
		expect(normalizeLinkLabel('  Foo  BAR  ')).toBe('foo bar');
	});

	it('idempotent: f(f(x)) === f(x)', () => {
		const samples = ['foo', '  Foo  BAR  ', 'a\tb\tc', ''];
		for (const s of samples) {
			expect(normalizeLinkLabel(normalizeLinkLabel(s))).toBe(normalizeLinkLabel(s));
		}
	});

	it('empty string normalizes to empty string', () => {
		expect(normalizeLinkLabel('')).toBe('');
		expect(normalizeLinkLabel('   ')).toBe('');
	});

	it('digits and punctuation are unchanged (other than case)', () => {
		expect(normalizeLinkLabel('Foo-2.0')).toBe('foo-2.0');
		expect(normalizeLinkLabel('A_B!C')).toBe('a_b!c');
	});
});

describe('buildLinkReferenceMap', () => {
	function mapFor(source: string) {
		const doc = parse(source);
		return buildLinkReferenceMap(doc.children);
	}

	it('resolves a single LRD by exact label', () => {
		const m = mapFor('[foo]: https://example.com\n');
		expect(m.resolve('foo')).toEqual({ url: 'https://example.com' });
	});

	it('returns undefined for unknown labels', () => {
		const m = mapFor('[foo]: https://example.com\n');
		expect(m.resolve('bar')).toBeUndefined();
	});

	it('returns the title when the LRD has one', () => {
		const m = mapFor('[foo]: https://example.com "Foo Site"\n');
		expect(m.resolve('foo')).toEqual({ url: 'https://example.com', title: 'Foo Site' });
	});

	it('matches normalized labels (case-insensitive, whitespace-collapsed)', () => {
		const m = mapFor('[Foo Bar]: https://example.com\n');
		expect(m.resolve('foo bar')).toEqual({ url: 'https://example.com' });
		expect(m.resolve('FOO  BAR')).toEqual({ url: 'https://example.com' });
	});

	it('first-wins on duplicate labels (CommonMark §4.7)', () => {
		const source = '[foo]: https://first.com\n\n[foo]: https://second.com\n';
		const m = mapFor(source);
		expect(m.resolve('foo')).toEqual({ url: 'https://first.com' });
	});

	it('walks recursively into blockquotes for LRDs', () => {
		const source = '> [bq]: https://example.com\n';
		const m = mapFor(source);
		expect(m.resolve('bq')).toEqual({ url: 'https://example.com' });
	});

	it('walks recursively into list items for LRDs', () => {
		const source = '- foo\n\n  [li]: https://example.com\n';
		const m = mapFor(source);
		expect(m.resolve('li')).toEqual({ url: 'https://example.com' });
	});

	it('skips LRDs missing a url (malformed definitions)', () => {
		const m = buildLinkReferenceMap([
			{
				kind: 'linkReferenceDefinition',
				leadingTrivia: '',
				raw: '[foo]:\n',
				metadata: { label: 'foo' }
			}
		]);
		expect(m.resolve('foo')).toBeUndefined();
	});

	it('returns a frozen result entry (cannot mutate)', () => {
		const m = mapFor('[foo]: https://example.com\n');
		const result = m.resolve('foo');
		expect(() => {
			(result as { url: string }).url = 'mutated';
		}).toThrow();
	});

	it('empty document returns a map whose resolve always returns undefined', () => {
		const m = mapFor('');
		expect(m.resolve('anything')).toBeUndefined();
	});
});

describe('buildLinkReferenceMap.signature', () => {
	function sigFor(source: string) {
		const doc = parse(source);
		return buildLinkReferenceMap(doc.children).signature;
	}

	it('empty document signature is empty string', () => {
		expect(sigFor('')).toBe('');
	});

	it('different LRD sets produce different signatures', () => {
		expect(sigFor('[foo]: https://a.com\n')).not.toBe(sigFor('[foo]: https://b.com\n'));
		expect(sigFor('[foo]: https://a.com\n')).not.toBe(sigFor('[bar]: https://a.com\n'));
	});

	it('identical LRD sets in different order produce the same signature', () => {
		const a = sigFor('[foo]: https://a.com\n\n[bar]: https://b.com\n');
		const b = sigFor('[bar]: https://b.com\n\n[foo]: https://a.com\n');
		expect(a).toBe(b);
	});

	it('title change is reflected in the signature', () => {
		expect(sigFor('[foo]: https://a.com\n')).not.toBe(sigFor('[foo]: https://a.com "T"\n'));
	});

	it('first-wins duplicates do not change the signature when the duplicate is added', () => {
		const a = sigFor('[foo]: https://a.com\n');
		const b = sigFor('[foo]: https://a.com\n\n[foo]: https://b.com\n');
		expect(a).toBe(b);
	});
});
