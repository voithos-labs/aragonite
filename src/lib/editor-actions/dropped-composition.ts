import { devWarn } from '../dev-warn';

/**
 * True when `e` is an input the browser sent outside a composition while the caller still holds
 * one open: the browser dropped it without a `compositionend`, so the caller ends it here. Every
 * holder of a composing flag asks this on its input events, or a dropped composition leaves it
 * refusing every later edit.
 */
export function endsDroppedComposition(e: Event, open: boolean): boolean {
	const { isComposing, inputType } = e as Partial<InputEvent>;
	if (!open || isComposing !== false) return false;
	// An engine's own composition input types belong to the composition, whatever flag they carry.
	if (/composition/i.test(inputType ?? '')) return false;
	devWarn(
		'composition',
		`a non-composing ${e.type} (${inputType}) arrived with no compositionend, so the browser dropped the composition; the editor ended it here`
	);
	return true;
}
