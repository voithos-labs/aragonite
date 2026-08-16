/**
 * The `data-` names a block decoration may not spell. `.block-host` is an ancestor of every walk
 * container, so an attribute here answers the ancestor lookups the CSS families, the offset walk
 * and selection/windowing all make — a decoration spelling one diverges the readers from what the
 * DOM actually holds. The list is what those consumers read via `closest()` or an ancestor
 * combinator; a name read only on the element that writes it is not in scope.
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
	'data-presentation',
	'data-table-row-idx'
]);

/** The name production `setAttribute` enforces: a name it refuses throws inside the decoration
 *  effect, taking the whole mount rather than one attribute. */
const ATTR_NAME = /^[A-Za-z_:][A-Za-z0-9_.:-]*$/;

/** A block decoration's attributes minus the names it may not spell, which are dropped with a dev
 *  warn. Reserved is asked in lowercase: `setAttribute` lowercases, so a capital is not a
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
