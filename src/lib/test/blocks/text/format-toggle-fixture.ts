/**
 * The format-toggle suites' shared door. `toggleInlineFormat` declines a kind whose policy row
 * declares no mark, which is the runtime guard that replaced the closed `InlineMarkKind` union;
 * every case here passes a rowed kind, so a null is a broken registration and throws.
 */

import {
	toggleInlineFormat,
	type InlineFormatEdit,
	type ToggleInlineFormatResult
} from '$lib/components/blocks/text/format-toggle';
import type { InlineMarkKind } from '$lib/cursor/pending-marks';
import { getInlineMarkPolicy, listInlineMarks } from '$lib/schema/inline-construct-policy';

export function toggleFormat(
	edit: InlineFormatEdit,
	format: InlineMarkKind
): ToggleInlineFormatResult {
	const result = toggleInlineFormat(edit, format);
	if (!result) throw new Error(`toggleInlineFormat declined "${format}": no mark row registered`);
	return result;
}

/** The bare delimiter run of a rowed kind. */
export function markersOf(format: InlineMarkKind): string {
	const mark = getInlineMarkPolicy(format);
	if (!mark) throw new Error(`no mark row registered for "${format}"`);
	return mark.markerBytes;
}

/** Every markable kind, off the table rather than re-listed — a new format joins these suites by
 *  registering a row. */
export const MARK_FORMATS: InlineMarkKind[] = listInlineMarks().map((entry) => entry.kind);
