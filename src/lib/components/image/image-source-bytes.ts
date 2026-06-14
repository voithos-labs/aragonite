// Inverse of the image scanner: rebuild source bytes when fields change
// (popover edits, drag-resize). Title quoting canonicalizes to double-quotes.

import type { InlineNode } from '../../core/nodes';

export interface ImageFields {
	alt: string;
	url: string;
	title?: string;
	width?: number;
	height?: number;
}

/** Canonical fields-as-persisted shape for an image inline node: omits
 *  optional keys the node doesn't carry so round-tripping through
 *  `buildImageSourceBytes` reproduces the original bytes. */
export function imageFieldsFromInline(image: InlineNode): ImageFields {
	return {
		alt: image.alt ?? '',
		url: image.url ?? '',
		...(image.title !== undefined ? { title: image.title } : {}),
		...(image.width !== undefined ? { width: image.width } : {}),
		...(image.height !== undefined ? { height: image.height } : {})
	};
}

export function buildImageSourceBytes(fields: ImageFields): string {
	const dimSuffix = buildDimSuffix(fields.width, fields.height);
	const altSegment = escapeAlt(fields.alt) + dimSuffix;
	const titleSegment = fields.title !== undefined ? ` "${escapeTitle(fields.title)}"` : '';
	return `![${altSegment}](${encodeDestination(fields.url)}${titleSegment})`;
}

function buildDimSuffix(width: number | undefined, height: number | undefined): string {
	if (width === undefined) return '';
	if (height === undefined) return `|${width}`;
	return `|${width}x${height}`;
}

function escapeTitle(title: string): string {
	return title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Alt sits inside `[...]`; an unescaped bracket closes the scan early and the
// image degrades to literal text on the next parse. Backslash-escape so the
// inline escape pass restores the literal characters.
function escapeAlt(alt: string): string {
	return alt.replace(/[[\]\\]/g, '\\$&');
}

// The destination scanner ends the URL at space/tab/`)`/`"`/`'` and has no
// angle-bracket form, so a local path with spaces would otherwise truncate.
// Percent-encode those bytes; idempotent since an encoded URL has no literal
// stop-char left.
function encodeDestination(url: string): string {
	return url.replace(
		/[ \t)"']/g,
		(c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')
	);
}
