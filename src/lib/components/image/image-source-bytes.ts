// Where an image edit becomes bytes: the dispatcher every write path calls, and below it the
// GFM form. The two live together because the image serializer must be named in exactly one
// module (G4.21).

import { encodeDestination, escapeTitle } from '../../core/inline/destination-bytes';
import type { ImageCrop, ImageFields, InlineNode } from '../../core/nodes';
import { devWarn } from '../../dev-warn';

// ── Where the bytes are written ─────────────────────────────────────────────

/**
 * Bytes to splice over `image`'s range, or `null` when the edit must be refused. Every image
 * write path goes through here (G4.21): if an inline syntax handler owns the node, it writes
 * the bytes back through its own `rewriteImage` hook, since GFM syntax written over another
 * syntax's bytes destroys them. Plugin side: docs/design/plugin-contract.md § Inline authoring.
 */
export function buildImageEditBytes(
	image: InlineNode,
	blockRaw: string,
	fields: ImageFields
): string | null {
	const claim = image.syntaxClaim;
	if (!claim) return buildImageSourceBytes(fields);

	const bytes = claim.rewriteImage?.(blockRaw.slice(image.start, image.end), fields) ?? null;
	if (bytes === null) {
		devWarn(
			'image-edit',
			`declined: the "${claim.prefix}" inline rung owns these bytes and ` +
				`${claim.rewriteImage ? 'its rewriteImage hook cannot represent this edit' : 'registered no rewriteImage hook'}`,
			fields
		);
	}
	return bytes;
}

/** Omits optional keys the node does not hold, so a rebuild writes back only what the source
 *  had. It does not promise the same bytes back (the GFM serializer normalizes); it does
 *  promise the alt text stops changing, so repeated resizes never grow the escapes. */
export function imageFieldsFromInline(image: InlineNode): ImageFields {
	return {
		alt: image.alt ?? '',
		url: image.url ?? '',
		...(image.title !== undefined ? { title: image.title } : {}),
		...(image.width !== undefined ? { width: image.width } : {}),
		...(image.height !== undefined ? { height: image.height } : {}),
		...(image.crop !== undefined ? { crop: image.crop } : {}),
		...(image.label !== undefined ? { label: image.label } : {})
	};
}

// ── The GFM serializer ──────────────────────────────────────────────────────

/** The inverse of the built-in grammar. Reach it through `buildImageEditBytes`, the only
 *  caller allowed to decide these bytes are GFM's to write. */
export function buildImageSourceBytes(fields: ImageFields): string {
	const dimSuffix = buildDimSuffix(fields.width, fields.height, fields.crop);
	const altSegment = escapeAlt(fields.alt) + dimSuffix;
	// Reference form: the size goes in the alt text, and the url and title are not
	// written here because they belong to the link reference definition.
	if (fields.label !== undefined) {
		return `![${altSegment}][${fields.label}]`;
	}
	const titleSegment = fields.title !== undefined ? ` "${escapeTitle(fields.title)}"` : '';
	return `![${altSegment}](${encodeDestination(fields.url)}${titleSegment})`;
}

function buildDimSuffix(
	width: number | undefined,
	height: number | undefined,
	crop: ImageCrop | undefined
): string {
	if (width === undefined) return '';
	if (height === undefined) return `|${width}`;
	return `|${width}x${height}${crop ? buildCropTail(crop) : ''}`;
}

/** Whole percents; the zoom only when it is one worth writing, trimmed to what it needs. */
function buildCropTail(crop: ImageCrop): string {
	const z = Math.round(crop.z * 100) / 100;
	const zoom = z === 1 ? '' : `,${String(z)}`;
	return `@${Math.round(crop.x)},${Math.round(crop.y)}${zoom}`;
}

// Alt text sits inside `[...]`, where an unescaped bracket ends the scan early. Unlike `title`
// and `url` it holds the label's bytes as written, so escaping everything would double every
// backslash on each commit; passing an existing backslash pair through untouched stops that.
function escapeAlt(alt: string): string {
	let out = '';
	for (let i = 0; i < alt.length; i++) {
		const ch = alt[i];
		if (ch === '\\' && i + 1 < alt.length) {
			out += ch + alt[i + 1];
			i++;
			continue;
		}
		out += ch === '[' || ch === ']' || ch === '\\' ? '\\' + ch : ch;
	}
	return out;
}
