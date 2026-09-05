// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { useParkFocusOnUnmount } from '../../components/blocks/surface-wiring.svelte';

function mountPair() {
	const root = document.createElement('div');
	root.tabIndex = -1;
	const block = document.createElement('div');
	block.tabIndex = 0;
	document.body.append(root, block);
	return { root, block };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('useParkFocusOnUnmount', () => {
	it('parks focus on the editor root when the focused block tears down', () => {
		const { root, block } = mountPair();
		block.focus();
		const dispose = $effect.root(() => {
			useParkFocusOnUnmount(
				() => block,
				() => root
			);
		});
		flushSync();

		dispose();

		expect(document.activeElement).toBe(root);
	});

	it('leaves focus alone when the block does not hold it', () => {
		const { root, block } = mountPair();
		const other = document.createElement('div');
		other.tabIndex = 0;
		document.body.append(other);
		other.focus();
		const dispose = $effect.root(() => {
			useParkFocusOnUnmount(
				() => block,
				() => root
			);
		});
		flushSync();

		dispose();

		expect(document.activeElement).toBe(other);
	});

	// The el is captured at effect run: at unmount the component's binding is already
	// cleared, and a live re-read would skip the park exactly when it is owed.
	it('parks through the element captured at effect time, not the live getter', () => {
		const { root, block } = mountPair();
		block.focus();
		let current: HTMLElement | null = block;
		const dispose = $effect.root(() => {
			useParkFocusOnUnmount(
				() => current,
				() => root
			);
		});
		flushSync();
		current = null;

		dispose();

		expect(document.activeElement).toBe(root);
	});
});
