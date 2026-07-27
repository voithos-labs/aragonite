/**
 * URL scheme allowlist for rendered href/src. Enforced at the render sinks
 * (inline-render link/autolink, image widget src) so author-controlled URLs
 * can't smuggle script execution into the DOM. The scheme predicates are pure;
 * `defaultLinkActivation` is the one DOM sink (it gates `window.open`).
 */

const ALLOWED_HREF_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);
// `asset:` is the webview asset protocol a desktop shell hands back for a local
// file (Tauri's `convertFileSrc`), and only off Windows — Windows serves the same
// protocol as `http://asset.localhost/…`, which the `http` entry already admits.
// Without it the allowlist is platform-dependent: every image in a shell-hosted
// editor loads on the developer's Windows box and blocks on macOS and Linux. It
// carries no script capability — no browser resolves it, and a webview that does
// serves bytes off disk. Not admitted for hrefs: an asset URL is a src.
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

/** Like href, but `data:`/`asset:` are allowed for images and `mailto:`/`tel:` are not. */
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
