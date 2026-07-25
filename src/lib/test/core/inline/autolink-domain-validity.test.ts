import { describe, it, expect } from 'vitest';
import { inlineOf } from './inline-test-helpers';

/**
 * GFM §6.9's valid-domain rule: "no underscores may be present in the last two
 * segments of the domain". The expectations below are cmark-gfm's own published
 * autolink cases (`test/extensions.txt`), which is the behavior GitHub renders.
 */

function autolinkUrls(raw: string): (string | undefined)[] {
	return inlineOf(raw)
		.filter((n) => n.kind === 'autolink')
		.map((n) => n.url);
}

describe('www autolink — valid domain (GFM §6.9)', () => {
	it.each(['www.xxx.yyy._zzz', 'www.xxx._yyy.zzz'])(
		'keeps %j literal — underscore in one of the last two segments',
		(raw) => {
			expect(autolinkUrls(raw)).toEqual([]);
		}
	);

	it('autolinks www._xxx.yyy.zzz — the underscore is left of the last two segments', () => {
		expect(autolinkUrls('www._xxx.yyy.zzz')).toEqual(['http://www._xxx.yyy.zzz']);
	});

	it('autolinks www.google.com/a_b — the underscore is in the path, not the domain', () => {
		expect(autolinkUrls('www.google.com/a_b')).toEqual(['http://www.google.com/a_b']);
	});

	// cmark-gfm permits `-` anywhere a host character is permitted (`data[i] != '-'`
	// is an explicit exemption from its punctuation check), so a segment may begin
	// with one. Pinned because a hyphen rule is the intuitive-but-wrong companion to
	// the underscore rule, and adding one would silently delist real domains.
	it('autolinks www.-b — a leading hyphen is a valid host character', () => {
		expect(autolinkUrls('www.-b')).toEqual(['http://www.-b']);
	});
});

describe('http/https autolink — valid domain (GFM §6.9)', () => {
	it.each(['http://xxx.yyy._zzz', 'https://xxx._yyy.zzz'])(
		'keeps %j literal — the underscore rule is not www-only',
		(raw) => {
			expect(autolinkUrls(raw)).toEqual([]);
		}
	);

	it('autolinks https://_xxx.yyy.zzz — underscore left of the last two segments', () => {
		expect(autolinkUrls('https://_xxx.yyy.zzz')).toEqual(['https://_xxx.yyy.zzz']);
	});

	it('autolinks a query string carrying underscores', () => {
		expect(autolinkUrls('https://example.com/?a_b=c_d')).toEqual(['https://example.com/?a_b=c_d']);
	});

	// The domain ends at the port separator, so a trailing-underscore path can't
	// reach back into the host and delist it.
	it('autolinks a host with a port and an underscore after it', () => {
		expect(autolinkUrls('http://example.com:8080/a_b')).toEqual(['http://example.com:8080/a_b']);
	});
});
