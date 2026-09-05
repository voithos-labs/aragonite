// Where an image edit becomes bytes: the claim dispatcher every write path calls, and
// under it the GFM branch. The two live together because G4.21 requires the image
// serializer to be named in exactly one module.

import { encodeDestination, escapeTitle } from '../../core/inline/destination-bytes';
import type { ImageFields, InlineNode } from '../../core/nodes';
import { devWarn } from '../../dev-warn';

// ── The write seam ──────────────────────────────────────────────────────────

/**
 * Bytes to splice over `image`'s range, or `null` when the edit must be declined. **Every image
 * write path goes through here** (G4.21): a node an inline rung claimed re-serializes through that
 * rung's `rewriteImage` hook, since built-in grammar over another syntax's bytes destroys them.
 * Plugin-side contract: docs/design/plugin-contract.md § Inline authoring.
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

/** Omits optional keys the node doesn't carry, so a rebuild writes back only what the
 *  source held. Byte-exactness is not the claim (the GFM serializer canonicalizes);
 *  idempotence on the alt is, so repeated resizes never grow the escapes. */
export function imageFieldsFromInline(image: InlineNode): ImageFields {
	return {
		alt: image.alt ?? '',
		url: image.url ?? '',
		...(image.title !== undefined ? { title: image.title } : {}),
		...(image.width !== undefined ? { width: image.width } : {}),
		...(image.height !== undefined ? { height: image.height } : {}),
		...(image.label !== undefined ? { label: image.label } : {})
	};
}

// ── The GFM serializer ──────────────────────────────────────────────────────

/** The built-in grammar's inverse. Reach it through `buildImageEditBytes`, the only
 *  caller entitled to decide these bytes are GFM's to write. */
export function buildImageSourceBytes(fields: ImageFields): string {
	const dimSuffix = buildDimSuffix(fields.width, fields.height);
	const altSegment = escapeAlt(fields.alt) + dimSuffix;
	// Reference form: the dimension hint rides in the alt, and url/title are not
	// written — they belong to the LRD.
	if (fields.label !== undefined) {
		return `![${altSegment}][${fields.label}]`;
	}
	const titleSegment = fields.title !== undefined ? ` "${escapeTitle(fields.title)}"` : '';
	return `![${altSegment}](${encodeDestination(fields.url)}${titleSegment})`;
}

function buildDimSuffix(width: number | undefined, height: number | undefined): string {
	if (width === undefined) return '';
	if (height === undefined) return `|${width}`;
	return `|${width}x${height}`;
}

// Alt sits inside `[...]`, where an unescaped bracket closes the scan early. Unlike
// `title` and `url` it carries RAW label bytes, so a blanket escape doubles every
// backslash per commit; passing any backslash PAIR through untouched keeps it idempotent.
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
