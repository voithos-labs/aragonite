import { describe, it, expect } from 'vitest';
import { isAllowedHrefScheme, isAllowedImageSrcScheme } from '../../core/url-policy';

describe('url-policy — href allowlist', () => {
	it.each([
		['https://example.com', true],
		['http://example.com', true],
		['mailto:foo@bar.com', true],
		['tel:+15551234', true],
		['/relative/path', true],
		['#fragment', true],
		['./rel.md', true],
		['javascript:alert(1)', false],
		['vbscript:msgbox(1)', false],
		['file:///etc/passwd', false],
		['data:text/html,<script>', false]
	])('isAllowedHrefScheme(%s) === %s', (url, expected) => {
		expect(isAllowedHrefScheme(url)).toBe(expected);
	});

	it('defeats control-char scheme obfuscation (java\\tscript:)', () => {
		expect(isAllowedHrefScheme('java\tscript:alert(1)')).toBe(false);
		expect(isAllowedHrefScheme('java\nscript:alert(1)')).toBe(false);
		expect(isAllowedHrefScheme('  javascript:alert(1)')).toBe(false);
	});
});

describe('url-policy — image src allowlist', () => {
	it.each([
		['https://example.com/a.png', true],
		['http://example.com/a.png', true],
		['data:image/png;base64,AAAA', true],
		['/local/a.png', true],
		['javascript:alert(1)', false],
		['vbscript:msgbox(1)', false],
		['file:///a.png', false]
	])('isAllowedImageSrcScheme(%s) === %s', (url, expected) => {
		expect(isAllowedImageSrcScheme(url)).toBe(expected);
	});
});
