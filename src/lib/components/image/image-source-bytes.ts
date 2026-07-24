// Inverse of the image scanner: rebuild source bytes when fields change
// (popover edits, drag-resize). Title quoting canonicalizes to double-quotes.

import type { InlineNode } from '../../core/nodes';

export interface ImageFields {
	alt: string;
	url: string;
	title?: string;
	width?: number;
	height?: number;
	/**
	 * Reference label, present only for reference-style images (`![alt][label]`).
	 * When set, `buildImageSourceBytes` emits the reference form and writes no
	 * url/title — those live in the LRD, so re-inlining them on a resize/alt edit
	 * would orphan the definition.
	 */
	label?: string;
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
		...(image.height !== undefined ? { height: image.height } : {}),
		...(image.label !== undefined ? { label: image.label } : {})
	};
}

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
