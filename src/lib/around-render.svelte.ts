/**
 * A step run before the DOM updates for a new value, and its partner run once the update is done.
 * Each `after` follows its own `before` with the value that `before` saw, even when the value moves
 * again inside one flush, which two hand-written effects over one getter can't promise. Only `read`
 * is tracked. Call during component init.
 */

import { untrack } from 'svelte';

export function aroundRender<T>(
	read: () => T,
	before: (value: T) => void,
	after: (value: T) => void
): void {
	// Written by `before` and read only by `after`, so every `before` run schedules one `after`.
	let ran = $state.raw<{ value: T } | null>(null);
	$effect.pre(() => {
		const value = read();
		untrack(() => {
			before(value);
			ran = { value };
		});
	});
	$effect(() => {
		const last = ran;
		if (last) untrack(() => after(last.value));
	});
}
