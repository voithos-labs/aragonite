/**
 * The attribute names a block decoration may not use. A decorated element (a block host, a list
 * item's box, a table row or cell) holds every element the offset traversal walks, so a reserved
 * `data-` name answers the ancestor lookups the CSS, that traversal, and selection and windowing
 * make through `closest()` or an ancestor selector.
 */

import { devWarn } from '../dev-warn';

export const RESERVED_BLOCK_ATTRS: ReadonlySet<string> = new Set([
	'data-block-path',
	'data-block-kind',
	'data-content-empty',
	'data-cross-block',
	'data-decoration-island',
	'data-focused',
	'data-gap-caret',
	'data-image-overlay',
	'data-image-widget',
	'data-inline-widget',
	'data-link-card',
	'data-list-marker',
	'data-pointer-gesture',
	'data-presentation',
	'data-table-row-idx',
	'data-task-checked'
]);

/** The attributes every decorated element renders itself. A decoration's cleanup removes what
 *  it set, so an overwrite would outlive the source: a row without `table-row`, a cell uneditable. */
const ELEMENT_OWNED_ATTRS: ReadonlySet<string> = new Set([
	'class',
	'contenteditable',
	'role',
	'style',
	'tabindex'
]);

/** The name grammar `setAttribute` enforces: a name it refuses throws inside the decoration
 *  effect, taking down the whole mount rather than one attribute. */
const ATTR_NAME = /^[A-Za-z_:][A-Za-z0-9_.:-]*$/;

/** A block decoration's attributes minus the names it may not use, which are dropped with a
 *  dev warning. The check is in lowercase: `setAttribute` lowercases, so a capital is only
 *  another spelling. */
export function acceptedBlockAttrs(
	attrs: Record<string, string> | undefined,
	path: number[]
): Array<[string, string]> {
	const accepted: Array<[string, string]> = [];
	for (const [name, value] of Object.entries(attrs ?? {})) {
		const lowered = name.toLowerCase();
		const refusal = !ATTR_NAME.test(name)
			? 'is not a valid attribute name'
			: lowered === 'class'
				? "is reserved by the editor (use the decoration's class field)"
				: RESERVED_BLOCK_ATTRS.has(lowered) || ELEMENT_OWNED_ATTRS.has(lowered)
					? 'is reserved by the editor'
					: null;
		if (refusal !== null) {
			devWarn('decorations', `block decoration attribute '${name}' ${refusal} and was dropped`, {
				path
			});
			continue;
		}
		accepted.push([name, value]);
	}
	return accepted;
}
