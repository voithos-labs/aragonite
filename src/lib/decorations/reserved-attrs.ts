/**
 * The `data-` names a block decoration may not use. A block host or a list item's box is an
 * ancestor of every element the offset traversal walks, so an attribute here answers the ancestor
 * lookups the CSS, that traversal, and selection and windowing all make. The list is what they
 * read through `closest()` or an ancestor selector; a name read only where it is written is not.
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

/** The name grammar `setAttribute` enforces: a name it refuses throws inside the decoration
 *  effect, taking down the whole mount rather than one attribute. */
const ATTR_NAME = /^[A-Za-z_:][A-Za-z0-9_.:-]*$/;

/** A block decoration's attributes minus the names it may not use, which are dropped with a
 *  dev warning. The check is in lowercase: `setAttribute` lowercases, so a capital is not a
 *  different name, only a different spelling of the same one. */
export function acceptedBlockAttrs(
	attrs: Record<string, string> | undefined,
	path: number[]
): Array<[string, string]> {
	const accepted: Array<[string, string]> = [];
	for (const [name, value] of Object.entries(attrs ?? {})) {
		const refusal = !ATTR_NAME.test(name)
			? 'is not a valid attribute name'
			: RESERVED_BLOCK_ATTRS.has(name.toLowerCase())
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
