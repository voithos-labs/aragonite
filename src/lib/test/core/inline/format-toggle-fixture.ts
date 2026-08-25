/**
 * The format-toggle suites' shared door. `toggleInlineFormat` declines a kind whose policy row
 * declares no mark, which is the runtime guard that replaced the closed `InlineMarkKind` union;
 * every case here passes a rowed kind, so a null is a broken registration and throws.
 */

import {
	isInlineFormatActive,
	isInlineFormatActiveAfter,
	toggleInlineFormat,
	type InlineFormatEdit,
	type ToggleInlineFormatResult
} from '$lib/core/inline/format-toggle';
import type { PresentationMode } from '$lib/presentation-mode';
import {
	getInlineMarkPolicy,
	listInlineMarks,
	type InlineMarkKind
} from '$lib/schema/inline-construct-policy';

/** Source mode by default: these suites pin the bytes a painting mode writes, and the marker-hiding
 *  fork has its own file. */
export function toggleFormat(
	edit: InlineFormatEdit,
	format: InlineMarkKind,
	mode: PresentationMode = 'source'
): ToggleInlineFormatResult {
	const result = toggleInlineFormat(edit, format, mode);
	if (!result) throw new Error(`toggleInlineFormat declined "${format}": no mark row registered`);
	return result;
}

/** The selection covering all of `raw`. */
export const whole = (raw: string) => ({ start: 0, end: raw.length });

export interface Press {
	display: string;
	start: number;
	end: number;
	format: InlineMarkKind;
	mode: PresentationMode;
}

/** One press with its pressed-state read on both sides, for the suites that assert the paint and
 *  the write agree. A decline leaves the read where it was, so `activeAfter` reports `active`. */
export function press({ display, start, end, format, mode }: Press) {
	const edit: InlineFormatEdit = { display, content: whole(display), selection: { start, end } };
	const active = isInlineFormatActive(edit, format);
	const result = toggleInlineFormat(edit, format, mode);
	return {
		active,
		wrote: result?.newDisplay ?? null,
		selected: result ? result.newDisplay.slice(result.newSelStart, result.newSelEnd) : null,
		activeAfter: result === null ? active : isInlineFormatActiveAfter(edit, result, format)
	};
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
