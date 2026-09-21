// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import LinkCard from '$lib/components/link-card/LinkCard.svelte';
import { resolveHref } from '$lib/core/inline-render';

// The card's Open button calls the consumer's `onLinkActivate`, with the URL the user just typed
// rather than a rendered node's. Every path into that hook goes through the render's own filter
// (a consumer rewrite, then the scheme allowlist), and this one shares that filter rather than
// copying it, so both give the same answer.

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
	// An icon button: its name is the accessible label, not text.
	const button = [...target.querySelectorAll('button')].find((b) =>
		/open/i.test(b.getAttribute('aria-label') ?? '')
	);
	return { onOpenLink, button: button as HTMLButtonElement, destroy: () => unmount(app) };
}

describe('the link card’s Open button rides the render path’s one URL check', () => {
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

	// The card deliberately opens on a blocked link so the URL can be repaired; only handing it
	// onward is refused.
	it('the card still renders its field for a blocked link', () => {
		const { button, destroy } = openCard('javascript:alert(1)');
		expect(button.closest('.md-link-card')?.querySelector('input')).not.toBeNull();
		void destroy();
	});

	// The same answer as a click in the document: that path reads the anchor's href, which the
	// render set through the same filter, so a consumer mapping its own scheme sees one URL.
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

	// Miss-analysis: every case here carried a non-empty draft, and nothing covered the empty
	// field, whose '' resolves as a relative URL and left Open enabled on a link with nowhere to go.
	it('an empty draft disables Open', () => {
		const { button, destroy } = openCard('');
		expect(button.disabled).toBe(true);
		void destroy();
	});

	// A rewrite that maps into a blocked scheme is blocked too: the allowlist runs last.
	it('a rewrite into a blocked scheme is still refused', () => {
		const { onOpenLink, button, destroy } = openCard('note://x', () => 'javascript:alert(1)');
		expect(button.disabled).toBe(true);
		button.click();
		flushSync();
		expect(onOpenLink).not.toHaveBeenCalled();
		void destroy();
	});
});
