// @vitest-environment jsdom
//
// Regression #48. Miss: every publish-ref fixture built slots over plain arrays, so the
// raw-vs-proxied identity check a $state-backed scope exercises was never compiled in.
import { describe, it, expect } from 'vitest';
import { publishRefSlot, refSlotsOver, type RefSlots } from '../../reactivity/publish-ref.svelte';

// Mirrors createBlockListState: a $state array behind the scope's slot accessors, so
// every write proxies and every read returns the canonical proxied identity.
function makeStateBackedSlots(): RefSlots<object> {
	const refs = $state<(object | undefined)[]>([]);
	return refSlotsOver(() => refs);
}

describe('publishRefSlot over $state-backed slots', () => {
	it('cleanup clears a container ref despite the write having proxied it', () => {
		const slots = makeStateBackedSlots();
		const containerApi = { focus() {} };

		const unpublish = publishRefSlot(slots, 0, containerApi);
		expect(slots.get(0)).toBeDefined();

		unpublish();
		expect(slots.get(0)).toBeUndefined();
	});

	it('cleanup still skips a slot a successor re-published', () => {
		const slots = makeStateBackedSlots();
		const unpublishFirst = publishRefSlot(slots, 0, { focus() {} });
		publishRefSlot(slots, 0, { focus() {} });
		const successor = slots.get(0);

		unpublishFirst();
		expect(slots.get(0)).toBe(successor);
	});
});
