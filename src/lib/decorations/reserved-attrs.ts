/**
 * The attribute names a block decoration may not use: every `data-` name the editor and its bundled
 * plugins set or read (a source scan, `reserved-block-attrs.test.ts`, holds the list to that). A
 * decorated element holds every element the offset traversal walks, so one of these names on it
 * answers a lookup the CSS, the traversal, selection or windowing makes, or paints a state.
 */

import { devWarn } from '../dev-warn';

export const RESERVED_BLOCK_ATTRS: ReadonlySet<string> = new Set([
	'data-active',
	'data-alert-source',
	'data-block-kind',
	'data-block-path',
	'data-body-end',
	'data-body-start',
	'data-caret-anchor',
	'data-construct-end',
	'data-construct-start',
	'data-content-empty',
	'data-crop-corner',
	'data-cross-block',
	'data-decoration-island',
	'data-drag-anchor',
	'data-editor-theme',
	'data-empty',
	'data-failed-block',
	'data-focused',
	'data-footnote-label',
	'data-gap-caret',
	'data-group',
	'data-image-overlay',
	'data-image-widget',
	'data-inline-menu',
	'data-inline-widget',
	'data-kind',
	'data-kind-cue',
	'data-link-card',
	'data-list-marker',
	'data-mod-active',
	'data-mount-id',
	'data-plain-click-jumps',
	'data-pointer-gesture',
	'data-presentation',
	'data-render-count',
	'data-reorder-scope',
	'data-scroll-mode',
	'data-source-end',
	'data-source-start',
	'data-table-row-idx',
	'data-task-checked',
	'data-title-empty',
	'data-trailing-spaces',
	'data-whole-block-input',
	'data-windowing'
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
