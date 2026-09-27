/**
 * URL scheme allowlist for rendered href/src, enforced at the render sinks so author-controlled
 * URLs cannot smuggle script execution into the DOM. `defaultLinkActivation` is the one DOM sink.
 */

import { devWarn } from '../dev-warn';

// `xmpp` hands the address to a chat client the way `mailto` hands it to a mail client.
const ALLOWED_HREF_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'xmpp']);
// `asset:` is a desktop shell's local-file protocol off Windows, needed for images on macOS and
// Linux; it carries no script capability, since no browser resolves it.
const ALLOWED_IMG_SCHEMES = new Set(['http', 'https', 'data', 'asset']);

// Mirrors the WHATWG URL parser's pre-scheme normalization, or a control byte (`java\tscript:`)
// would slip past the allowlist.
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

/** The default when a consumer supplies no `onLinkActivate`, gated on the href allowlist. A block
 *  reports through `onBlocked` (the `error` channel), since a production host may act on it. */
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
