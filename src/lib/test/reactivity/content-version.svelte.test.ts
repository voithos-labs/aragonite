// The key itself: a number that moves only when a door says the bytes moved. Who calls the door
// is `content-version-doors.test.ts`.
import { describe, it, expect } from 'vitest';
import { createContentVersion } from '../../reactivity/content-version.svelte';

describe('content version', () => {
	it('is stable across reads until a bump — otherwise it is a clock, not a key', () => {
		const cleanup = $effect.root(() => {
			const version = createContentVersion();
			const first = version.read();
			expect(version.read()).toBe(first);
			version.bump();
			expect(version.read()).not.toBe(first);
			expect(version.read()).toBe(version.read());
		});
		cleanup();
	});

	// The memo contract: a reader inside a `$derived` recomputes on the bump and not otherwise.
	it('a derived reader recomputes exactly once per bump', () => {
		const cleanup = $effect.root(() => {
			const version = createContentVersion();
			let computed = 0;
			const memo = $derived.by(() => {
				version.read();
				return ++computed;
			});
			const read = () => memo;
			expect(read()).toBe(1);
			expect(read()).toBe(1);
			version.bump();
			expect(read()).toBe(2);
		});
		cleanup();
	});
});
