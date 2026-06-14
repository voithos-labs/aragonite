/**
 * URL scheme allowlist for rendered href/src. Enforced at the render sinks
 * (inline-render link/autolink, image widget src) so author-controlled URLs
 * can't smuggle script execution into the DOM. Pure — no DOM, no config.
 */

const ALLOWED_HREF_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);
const ALLOWED_IMG_SCHEMES = new Set(['http', 'https', 'data']);

// Browsers ignore tab/newline/CR inside a URL when resolving its scheme, so
// `java\tscript:` runs. Strip those before scheme detection to match.
function schemeOf(url: string): string | null {
	const cleaned = url.replace(/[\t\n\r]/g, '').trim();
	const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(cleaned);
	return match ? match[1].toLowerCase() : null;
}

/** No scheme (relative / fragment / protocol-relative) is allowed; otherwise must be allowlisted. */
export function isAllowedHrefScheme(url: string): boolean {
	const scheme = schemeOf(url);
	return scheme === null || ALLOWED_HREF_SCHEMES.has(scheme);
}

/** Like href, but `data:` is allowed for images (data:image is common) and `mailto:`/`tel:` are not. */
export function isAllowedImageSrcScheme(url: string): boolean {
	const scheme = schemeOf(url);
	return scheme === null || ALLOWED_IMG_SCHEMES.has(scheme);
}
