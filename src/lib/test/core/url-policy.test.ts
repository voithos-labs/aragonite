// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	isAllowedHrefScheme,
	isAllowedImageSrcScheme,
	defaultLinkActivation
} from '../../core/url-policy';

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

	it('strips a leading C0 control before scheme detection', () => {
		const c0 = (code: number) => String.fromCharCode(code) + 'javascript:alert(1)';
		expect(isAllowedHrefScheme(c0(1))).toBe(false);
		expect(isAllowedHrefScheme(c0(0x1f))).toBe(false);
		expect(isAllowedImageSrcScheme(c0(1))).toBe(false);
	});
});

describe('url-policy — defaultLinkActivation', () => {
	afterEach(() => vi.restoreAllMocks());

	it('opens allowed http(s) links in a noopener tab', () => {
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		defaultLinkActivation('https://example.com', new MouseEvent('click'));
		expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
	});

	it('refuses disallowed schemes (incl. control-byte obfuscation) and warns instead', () => {
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		defaultLinkActivation('javascript:alert(1)', new MouseEvent('click'));
		defaultLinkActivation('\x01javascript:alert(1)', new MouseEvent('click'));
		expect(open).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledTimes(2);
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
