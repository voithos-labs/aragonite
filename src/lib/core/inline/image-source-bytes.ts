// Where an image edit becomes bytes: the one function every image write goes through, and
// below it the GFM serializer, which nothing else may call.

import { encodeDestination, escapeTitle } from './destination-bytes';
import type { ImageFields, InlineNode } from '../nodes';
import { buildDimSuffix } from './image-dimensions';
import { devWarn } from '../../dev-warn';

// ── Where the bytes are written ─────────────────────────────────────────────

/** Bytes to splice over `image`'s range, or null when the edit is refused. A node a plugin's
 *  syntax owns is written by its `rewriteImage` hook (`docs/design/plugin-contract.md`). */
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
			`declined: the "${claim.prefix}" inline syntax handler owns these bytes and ` +
				`${claim.rewriteImage ? 'its rewriteImage hook cannot represent this edit' : 'registered no rewriteImage hook'}`,
			fields
		);
	}
	return bytes;
}

/** Only the optional keys the node holds, so a rebuild adds no field the source lacked and
 *  repeated resizes leave the alt text unchanged. */
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

export function sameImageFields(a: ImageFields, b: ImageFields): boolean {
	return (
		a.alt === b.alt &&
		a.url === b.url &&
		a.title === b.title &&
		a.width === b.width &&
		a.height === b.height &&
		a.label === b.label &&
		a.crop?.x === b.crop?.x &&
		a.crop?.y === b.crop?.y &&
		a.crop?.z === b.crop?.z
	);
}

// ── The GFM serializer ──────────────────────────────────────────────────────

/** The inverse of the built-in grammar; call `buildImageEditBytes`, which decides whether the
 *  bytes are GFM's to write. */
export function buildImageSourceBytes(fields: ImageFields): string {
	const dimSuffix = buildDimSuffix(fields.width, fields.height, fields.crop);
	const altSegment = escapeAlt(fields.alt) + dimSuffix;
	// A reference image's url and title belong to its link reference definition.
	if (fields.label !== undefined) {
		return `![${altSegment}][${fields.label}]`;
	}
	const titleSegment = fields.title !== undefined ? ` "${escapeTitle(fields.title)}"` : '';
	return `![${altSegment}](${encodeDestination(fields.url)}${titleSegment})`;
}

// Alt text keeps the label's bytes as written: a bare bracket is escaped so it can't end the
// label, and an existing backslash pair passes through so repeated commits never double it.
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
