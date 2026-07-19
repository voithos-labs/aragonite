// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { mountDecorationWidget } from '$lib/decorations/widget-dom';
import type { BlockDecoration } from '$lib/decorations/types';
import BadgeFixture from './fixtures/BadgeFixture.svelte';

const dec: BlockDecoration = { type: 'block', path: [0] };

describe('mountDecorationWidget', () => {
	it('buildDom arm returns the built element; destroy detaches it', () => {
		const handle = mountDecorationWidget(
			{
				buildDom: () => {
					const el = document.createElement('span');
					el.textContent = 'badge';
					return el;
				}
			},
			dec
		);
		expect(handle).not.toBeNull();
		document.body.appendChild(handle!.el);
		expect(document.body.textContent).toBe('badge');
		handle!.destroy();
		expect(handle!.el.isConnected).toBe(false);
	});

	it('component arm mounts with the decoration prop; destroy unmounts', () => {
		const handle = mountDecorationWidget({ component: BadgeFixture }, dec);
		expect(handle).not.toBeNull();
		document.body.appendChild(handle!.el);
		expect(handle!.el.querySelector('.badge-fixture')?.textContent).toBe('block');
		handle!.destroy();
		expect(handle!.el.isConnected).toBe(false);
	});

	it('a throwing buildDom is contained: null returned, error reported', () => {
		const reportError = vi.fn();
		const handle = mountDecorationWidget(
			{
				buildDom: () => {
					throw new Error('boom');
				}
			},
			dec,
			reportError
		);
		expect(handle).toBeNull();
		expect(reportError).toHaveBeenCalledOnce();
	});
});
