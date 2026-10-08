/**
 * A windowed child's height reaches its own block list's height table: in the list's batched
 * pass at mount, again after an edit, and again on a resize. Call during component init, and
 * before the component provides a block list of its own, since it reads its list's channel.
 */
import { getContext, untrack } from 'svelte';
import { CHILD_MEASURE_KEY, type ChildMeasureChannel } from '../editor-keys';

export interface MeasuredChildOpts {
	getId: () => string;
	/** The child's own path; its last index is its position in the list. */
	getPath: () => readonly number[];
	/** The element whose border box is the child's height. */
	getEl: () => HTMLElement | null;
	/** Read reactively: a change re-measures, except at mount, which the batched pass owns. */
	getRaw: () => string;
}

export function useMeasuredChild(opts: MeasuredChildOpts): void {
	const channel = getContext<ChildMeasureChannel | undefined>(CHILD_MEASURE_KEY);
	// Absent only in a bare test mount with no list above.
	if (!channel) return;

	const readHeight = () => opts.getEl()?.getBoundingClientRect().height ?? 0;
	// A primitive, so a fresh path array for the same position doesn't register the child again.
	const registration = $derived(`${opts.getPath().join()}|${opts.getId()}`);
	$effect(() => {
		void registration;
		return untrack(() => channel.register(opts.getPath(), opts.getId(), readHeight));
	});

	let firstRun = true;
	$effect(() => {
		void opts.getRaw();
		if (firstRun) {
			firstRun = false;
			return;
		}
		untrack(() => channel.measureNow(opts.getId()));
	});

	// Growth with no edit (an image decoding, a formula showing its source) would slide the page.
	$effect(() => {
		const el = opts.getEl();
		if (!el) return;
		return channel.watchSize(el, (entry) => {
			const box = entry.borderBoxSize?.[0];
			const height = box ? box.blockSize : entry.contentRect?.height;
			if (height != null) channel.measureOnResize(opts.getId(), height);
		});
	});
}
