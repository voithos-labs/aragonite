/**
 * URL scheme allowlist for rendered href/src, enforced at the render sinks so author-controlled
 * URLs cannot smuggle script execution into the DOM. `defaultLinkActivation` is the one DOM sink.
 */

import { devWarn } from '../dev-warn';

const ALLOWED_HREF_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);
// `asset:` is a desktop shell's local-file protocol off Windows, where the same URL arrives as
// `http://asset.localhost/...`, so omitting it blocks every image on macOS and Linux while
// passing on a Windows dev box. It carries no script capability: no browser resolves it.
const ALLOWED_IMG_SCHEMES = new Set(['http', 'https', 'data', 'asset']);

// Matches the WHATWG URL parser's pre-scheme normalization: it strips ASCII tab/newline anywhere
// and leading C0-control-or-space. `java\tscript:` runs in the browser, so normalizing the same
// way here is what stops a control byte from trivially bypassing the allowlist.
function schemeOf(url: string): string | null {
	const stripped = url.replace(/[\t\n\r]/g, '');
	let i = 0;
	while (i < stripped.length && stripped.charCodeAt(i) <= 0x20) i++;
	const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(stripped.slice(i));
	return match ? match[1].toLowerCase() : null;
}

/** A schemeless URL (relative, fragment, protocol-relative) is allowed. */
export function isAllowedHrefScheme(url: string): boolean {
	const scheme = schemeOf(url);
	return scheme === null || ALLOWED_HREF_SCHEMES.has(scheme);
}

/** Same rule as href over a different set: schemes that hand bytes to an `<img>`. */
export function isAllowedImageSrcScheme(url: string): boolean {
	const scheme = schemeOf(url);
	return scheme === null || ALLOWED_IMG_SCHEMES.has(scheme);
}

/**
 * The default when a consumer supplies no `onLinkActivate`, gated on the href allowlist. A block
 * is a security-relevant signal a production host can act on, so it reports through `onBlocked`
 * (the editor's `error` channel) rather than only reaching a dev console.
 */
export function defaultLinkActivation(
	url: string,
	_event: MouseEvent,
	onBlocked?: (url: string) => void
): void {
	if (isAllowedHrefScheme(url)) {
		window.open(url, '_blank', 'noopener,noreferrer');
		return;
	}
	devWarn('url-policy', `blocked link with disallowed scheme: ${url}`);
	onBlocked?.(url);
}
