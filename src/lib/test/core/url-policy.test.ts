// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { takeDevWarns } from '../support/warn-gate';
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
		['data:text/html,<script>', false],
		// Deliberately image-only: a webview asset URL is a src, and nothing has asked
		// for it as a navigation target.
		['asset://localhost/a.png', false]
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

	// Miss-analysis: the blocked arm was pinned through a console spy — the one reader the warn
	// gate cannot see — so a bare production `console.warn` read as covered while escaping the
	// sentinel funnel, and no case asked what a HOST learns when a link is refused.
	it('refuses disallowed schemes (incl. control-byte obfuscation) and reports each one', () => {
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		const blocked: string[] = [];
		const report = (url: string) => void blocked.push(url);
		defaultLinkActivation('javascript:alert(1)', new MouseEvent('click'), report);
		defaultLinkActivation('\x01javascript:alert(1)', new MouseEvent('click'), report);
		expect(open).not.toHaveBeenCalled();
		expect(blocked).toEqual(['javascript:alert(1)', '\x01javascript:alert(1)']);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['url-policy', 'url-policy']);
	});
});

describe('url-policy — image src allowlist', () => {
	it.each([
		['https://example.com/a.png', true],
		['http://example.com/a.png', true],
		['data:image/png;base64,AAAA', true],
		['/local/a.png', true],
		// Tauri's asset protocol: `http://asset.localhost/…` on Windows, `asset://…`
		// everywhere else, so admitting only the first blocks every image off Windows.
		['asset://localhost/a.png', true],
		['http://asset.localhost/a.png', true],
		['javascript:alert(1)', false],
		['vbscript:msgbox(1)', false],
		['file:///a.png', false]
	])('isAllowedImageSrcScheme(%s) === %s', (url, expected) => {
		expect(isAllowedImageSrcScheme(url)).toBe(expected);
	});
});
