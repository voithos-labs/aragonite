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
	const altSegment = fields.alt + dimSuffix;
	const titleSegment = fields.title !== undefined ? ` "${escapeTitle(fields.title)}"` : '';
	return `![${altSegment}](${fields.url}${titleSegment})`;
}

function buildDimSuffix(width: number | undefined, height: number | undefined): string {
	if (width === undefined) return '';
	if (height === undefined) return `|${width}`;
	return `|${width}x${height}`;
}

function escapeTitle(title: string): string {
	return title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
