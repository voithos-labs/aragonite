// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import LinkCard from '$lib/components/link-card/LinkCard.svelte';
import { resolveHref } from '$lib/core/inline-render';

// The card's Open button is a SINK into the consumer's `onLinkActivate`, and its URL is the one
// the user just typed rather than a rendered node's. Every other path into that hook is filtered
// by the render path's funnel (a consumer rewrite, then the scheme allowlist); this one was not,
// so `javascript:` reached it. The funnel is shared, not copied — parity is the point.

function openCard(url: string, resolveLinkUrl: (raw: string) => string = (u) => u) {
	const onOpenLink = vi.fn();
	const target = document.createElement('div');
	document.body.appendChild(target);
	const app = mount(LinkCard, {
		target,
		props: {
			url,
			canWrite: true,
			focusEpoch: 0,
			onCommit: vi.fn(),
			onOpenLink,
			onRemove: vi.fn(),
			resolveHref: (raw: string) => resolveHref({ resolveLinkUrl }, raw)
		}
	});
	flushSync();
	const button = [...target.querySelectorAll('button')].find((b) =>
		/open/i.test(b.textContent ?? '')
	);
	return { onOpenLink, button: button as HTMLButtonElement, destroy: () => unmount(app) };
}

describe('the link card’s Open button rides the render path’s URL funnel', () => {
	it('a blocked scheme never reaches the hook, and the button says so', () => {
		const { onOpenLink, button, destroy } = openCard('javascript:alert(1)');
		expect(button.disabled).toBe(true);
		button.click();
		flushSync();
		expect(onOpenLink).not.toHaveBeenCalled();
		void destroy();
	});

	it('an allowed scheme opens', () => {
		const { onOpenLink, button, destroy } = openCard('https://example.com');
		expect(button.disabled).toBe(false);
		button.click();
		flushSync();
		expect(onOpenLink).toHaveBeenCalledWith('https://example.com', expect.anything());
		void destroy();
	});

	// The card deliberately OPENS on a blocked link so the URL can be repaired; only handing it
	// onward is refused.
	it('the card still renders its field for a blocked link', () => {
		const { button, destroy } = openCard('javascript:alert(1)');
		expect(button.closest('.md-link-card')?.querySelector('input')).not.toBeNull();
		void destroy();
	});

	// Parity with a document click: that path reads the anchor's href, which the render path set
	// through the same funnel — so a consumer mapping its own scheme sees ONE resolved URL.
	it('a consumer’s rewrite reaches the hook exactly as it does from a click', () => {
		const map = (raw: string) =>
			raw.startsWith('note://') ? `https://notes/${raw.slice(7)}` : raw;
		const { onOpenLink, button, destroy } = openCard('note://alpha', map);
		button.click();
		flushSync();
		expect(onOpenLink).toHaveBeenCalledWith('https://notes/alpha', expect.anything());
		// The href a rendered anchor would carry for the same bytes.
		expect(resolveHref({ resolveLinkUrl: map }, 'note://alpha')).toBe('https://notes/alpha');
		void destroy();
	});

	// Miss: every funnel row carried a non-empty draft; nothing pinned the empty field, whose
	// '' resolves as a relative URL and kept Open live on a link with nowhere to go.
	it('an empty draft disables Open', () => {
		const { button, destroy } = openCard('');
		expect(button.disabled).toBe(true);
		void destroy();
	});

	// A rewrite that maps INTO a blocked scheme is blocked too: the allowlist runs last.
	it('a rewrite into a blocked scheme is still refused', () => {
		const { onOpenLink, button, destroy } = openCard('note://x', () => 'javascript:alert(1)');
		expect(button.disabled).toBe(true);
		button.click();
		flushSync();
		expect(onOpenLink).not.toHaveBeenCalled();
		void destroy();
	});
});
