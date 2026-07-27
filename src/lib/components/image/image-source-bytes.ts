// Inverse of the image scanner: rebuild source bytes when fields change
// (popover edits, drag-resize). Title quoting canonicalizes to double-quotes.

import type { ImageFields, InlineNode } from '../../core/nodes';
import { devWarn } from '../../dev-warn';

// ── The write seam ──────────────────────────────────────────────────────────

/**
 * Bytes to splice over `image`'s range for `fields`, or `null` when the edit must
 * be declined. **Every image write path goes through here** (G4.21): the built-in
 * GFM serializer below is one branch of it, reached only for bytes the built-in
 * scanner read. An inline rung may mint an `image` over syntax of its own, and
 * re-emitting that node's fields as GFM would replace the author's bytes wholesale
 * — so a claimed node re-serializes through its rung's `rewriteImage` hook, and a
 * rung that declares none (or whose hook declines this edit) yields `null`. The
 * caller drops the commit; nothing else in the editor may write those bytes.
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

/** Canonical fields-as-persisted shape for an image inline node: omits optional
 *  keys the node doesn't carry, so a rebuild writes back only what the source held
 *  rather than materializing an empty title or a zero width. Byte-exactness is not
 *  the claim — the GFM serializer canonicalizes (title quoting, destination
 *  encoding), and for a node an inline rung claimed the bytes are the rung's, which
 *  only its `rewriteImage` reproduces. What IS pinned is idempotence on the alt:
 *  a rebuilt span rebuilds to itself, so repeated resizes never grow the escapes. */
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

/** The built-in grammar's inverse. Reach it through `buildImageEditBytes`, which
 *  is the only caller entitled to decide these bytes are GFM's to write. */
export function buildImageSourceBytes(fields: ImageFields): string {
	const dimSuffix = buildDimSuffix(fields.width, fields.height);
	const altSegment = escapeAlt(fields.alt) + dimSuffix;
	// Reference form: the dimension hint rides in the alt, `[label]` is preserved
	// verbatim, and url/title are not written (they belong to the LRD).
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

function escapeTitle(title: string): string {
	return title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Alt sits inside `[...]`; an unescaped bracket closes the scan early and the
// image degrades to literal text on the next parse. Unlike `title` and `url`,
// which arrive spec-processed, `alt` carries RAW label bytes — the scanner slices
// the label without unescaping — so a blanket escape re-escapes what the source
// already escaped and doubles every backslash on each commit (a drag-resize alone
// grew `![C:\path]` to `![C:\\path]` to `![C:\\\\path]`). Pass any backslash PAIR
// through untouched and escape only bare bytes: idempotent, like
// `encodeDestination`, and byte-exact on alt the source already escaped. The pair
// is "backslash + anything", not "backslash + escapable punctuation" — a backslash
// before an ordinary letter is inert for the label scan, so escaping it would grow
// the user's bytes for nothing.
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

// Bare destinations end at whitespace/`"`/`'` and may carry parens only as
// balanced pairs (CommonMark §6.3), so a path with spaces would truncate and
// a lone paren would unbalance the pair the closing `)` needs. Percent-encode
// those bytes; idempotent since an encoded URL has no literal stop-char left.
function encodeDestination(url: string): string {
	return url.replace(
		/[ \t()"']/g,
		(c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')
	);
}
