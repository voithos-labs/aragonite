import { describe, it, expect } from 'vitest';
import { normalizeLinkLabel } from '../../../core/inline/link-reference-resolver';

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
