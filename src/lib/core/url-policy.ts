/**
 * URL scheme allowlist for rendered href/src. Enforced at the render sinks
 * (inline-render link/autolink, image widget src) so author-controlled URLs
 * can't smuggle script execution into the DOM. The scheme predicates are pure;
 * `defaultLinkActivation` is the one DOM sink (it gates `window.open`).
 */

const ALLOWED_HREF_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);
// `asset:` is a desktop shell's local-file protocol off Windows, where the same URL
// arrives as `http://asset.localhost/…` — omitting it makes the policy platform-dependent,
// passing on the developer's box and blocking every image on macOS and Linux. It carries
// no script capability: no browser resolves it, and a webview that does serves bytes off disk.
const ALLOWED_IMG_SCHEMES = new Set(['http', 'https', 'data', 'asset']);

// Match the WHATWG URL parser's pre-scheme normalization: it strips ASCII
// tab/newline anywhere and leading C0-control-or-space before resolving the
// scheme. `java\tscript:` and a leading-control `javascript:` both run in the
// browser, so normalize the same way here or the allowlist is trivially
// bypassed by prefixing a control byte.
function schemeOf(url: string): string | null {
	const stripped = url.replace(/[\t\n\r]/g, '');
	let i = 0;
	while (i < stripped.length && stripped.charCodeAt(i) <= 0x20) i++;
	const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(stripped.slice(i));
	return match ? match[1].toLowerCase() : null;
}

/** No scheme (relative / fragment / protocol-relative) is allowed; otherwise must be allowlisted. */
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
 * Safe-by-default link open used when the consumer supplies no `onLinkActivate`.
 * Gated on the href allowlist so a `javascript:` link can't execute on Ctrl/Cmd+click.
 */
export function defaultLinkActivation(url: string, _event: MouseEvent): void {
	if (isAllowedHrefScheme(url)) {
		window.open(url, '_blank', 'noopener,noreferrer');
	} else {
		console.warn(`Blocked link with disallowed scheme: ${url}`);
	}
}
