// @vitest-environment jsdom
// The mounted link card: the IME key guard, the Open button's url check, and a rebound
// open chord.
import { createMenuPresence } from '$lib/components/menu/menu-presence.svelte';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import { parse } from '$lib/core/parser';
import { createEditorEvents } from '$lib/editor-events';
import LinkCard from '$lib/components/link-card/LinkCard.svelte';
import LinkCardHost from '$lib/components/link-card/LinkCardHost.svelte';
import { createLinkCardState } from '$lib/components/link-card/link-card-state.svelte';
import { type InlineRangeCommit } from '$lib/editor-actions/inline-range-commit';
import { type CaretRestore } from '$lib/selection/caret-restore';
import { fixtureReading } from '../../harness/fixture-grammar';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { commandContext } from '../../support/command-context';
import { resolveHref } from '$lib/core/inline-render';
import {
	installLayoutStubs,
	mountEditor,
	pressKeyAt,
	destroyMountedEditors
} from '$lib/test/harness/mount-editor.svelte';
import { dispatchKey } from '$lib/test/harness/settle';

// A mounted card that an assertion left standing would leak into the next section.
const liveApps = new Set<() => void>();
function trackApp(app: ReturnType<typeof mount>): () => void {
	const destroy = () => {
		if (liveApps.delete(destroy)) void unmount(app);
	};
	liveApps.add(destroy);
	return destroy;
}
const unmountLeftovers = () => [...liveApps].forEach((destroy) => destroy());

describe('IME guard', () => {
	afterEach(unmountLeftovers);

	// The link card ignores Enter, Tab and Escape while an IME composition is open.
	// Miss-analysis: no card key test carried `isComposing`, so IME confirm and cancel keys acted.

	function key(name: string, isComposing: boolean): KeyboardEvent {
		return new KeyboardEvent('keydown', {
			key: name,
			isComposing,
			bubbles: true,
			cancelable: true
		});
	}

	// ── The card's own field ────────────────────────────────────────────────────

	function mountCard() {
		const onCommit = vi.fn();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const app = mount(LinkCard, {
			target,
			props: {
				url: 'https://example.com',
				canWrite: true,
				focusEpoch: 0,
				onCommit,
				onOpenLink: vi.fn(),
				onRemove: vi.fn(),
				opensCard: () => false,
				resolveHref: (raw: string) => raw
			}
		});
		flushSync();
		const input = target.querySelector('input')!;
		return { onCommit, input, destroy: trackApp(app) };
	}

	describe('IME keystrokes never operate the card', () => {
		it('Enter confirming a conversion does not commit; the plain Enter still does', () => {
			const { onCommit, input, destroy } = mountCard();
			input.dispatchEvent(key('Enter', true));
			expect(onCommit).not.toHaveBeenCalled();
			input.dispatchEvent(key('Enter', false));
			expect(onCommit).toHaveBeenCalledWith('https://example.com');
			void destroy();
		});

		it('Tab mid-composition does not step the focus trap', () => {
			const { input, destroy } = mountCard();
			input.focus();
			input.dispatchEvent(key('Tab', true));
			expect(document.activeElement).toBe(input);
			input.dispatchEvent(key('Tab', false));
			expect(document.activeElement).not.toBe(input);
			void destroy();
		});
	});

	// ── The host's document-level Escape ────────────────────────────────────────

	async function mountHost() {
		const card = createLinkCardState({
			onOpen: () => {},
			canOpen: () => true,
			canEnter: () => true,
			canOpenCreate: () => true
		});
		const restore = vi.fn();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const app = mount(LinkCardHost, {
			target,
			props: {
				card,
				inlineRange: {} as InlineRangeCommit,
				events: createEditorEvents(),
				getDoc: () => parse('Visit [example](https://example.com) now\n'),
				getEditorEl: () => target,
				measureRange: () => [],
				activateLink: vi.fn(),
				resolveLinkUrl: (u: string) => u,
				reading: fixtureReading(),
				grammar: defaultGrammarView,
				caretRestore: { save: vi.fn(), saveCurrent: vi.fn(), restore } as CaretRestore,
				menuPresence: createMenuPresence({ isReading: () => false }),
				commands: commandContext()
			}
		});
		card.enter({ path: [0], sourceStart: 6 });
		flushSync();
		// The card takes focus a tick after its anchor is placed, so the Escape that restores the
		// caret finds the card holding it.
		await tick();
		return { card, restore, destroy: trackApp(app) };
	}

	describe('Escape cancelling a conversion does not close the card', () => {
		it('the composing Escape is ignored; the plain one closes and restores the caret', async () => {
			const { card, restore, destroy } = await mountHost();
			expect(card.getTarget()).not.toBeNull();
			document.dispatchEvent(key('Escape', true));
			flushSync();
			expect(card.getTarget()).not.toBeNull();
			document.dispatchEvent(key('Escape', false));
			flushSync();
			expect(card.getTarget()).toBeNull();
			expect(restore).toHaveBeenCalled();
			void destroy();
		});
	});
});

describe('open button', () => {
	afterEach(unmountLeftovers);

	// The card's Open button hands the consumer's `onLinkActivate` the typed URL through the render's
	// own filter (a consumer rewrite, then the scheme allowlist), so a click and Open give one answer.

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
				opensCard: () => false,
				resolveHref: (raw: string) => resolveHref({ resolveLinkUrl }, raw)
			}
		});
		flushSync();
		// An icon button: its name is the accessible label, not text.
		const button = [...target.querySelectorAll('button')].find((b) =>
			/open/i.test(b.getAttribute('aria-label') ?? '')
		);
		return { onOpenLink, button: button as HTMLButtonElement, destroy: trackApp(app) };
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

		// Miss-analysis: every case carried a non-empty draft, and '' resolves as a relative URL.
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
});

describe('rebound chord', () => {
	// The card consumes whatever chord opens it, so a rebinding never falls through to the browser.
	// Miss-analysis: the card's tests pressed only the default Mod+K, never a rebound chord.

	beforeAll(installLayoutStubs);
	afterEach(destroyMountedEditors);

	async function openCardWith(chord: KeyboardEventInit): Promise<HTMLInputElement> {
		const mounted = mountEditor({
			source: 'see [x](https://e.c) now\n',
			presentationMode: 'live',
			keybindings: [{ chord: 'Mod+L', command: 'link.openCard' }]
		});
		await pressKeyAt(mounted, [0], 5, chord);
		const field = document.querySelector<HTMLInputElement>('[data-link-card] input');
		if (!field) throw new Error('the link card did not open');
		return field;
	}

	describe('the link card takes the chords that open it', () => {
		it('takes a chord the consumer bound to link.openCard', async () => {
			const field = await openCardWith({ key: 'l', ctrlKey: true });

			expect(dispatchKey(field, { key: 'l', ctrlKey: true }).defaultPrevented).toBe(true);
		});

		it('still takes the default Mod+K', async () => {
			const field = await openCardWith({ key: 'k', ctrlKey: true });

			expect(dispatchKey(field, { key: 'k', ctrlKey: true }).defaultPrevented).toBe(true);
		});

		it('leaves a chord bound to nothing alone', async () => {
			const field = await openCardWith({ key: 'k', ctrlKey: true });

			expect(dispatchKey(field, { key: 'j', ctrlKey: true }).defaultPrevented).toBe(false);
		});
	});
});
