// @vitest-environment jsdom
// Miss-analysis: every card key test used plain keys and none carried `isComposing`, so the IME
// confirm and cancel keystrokes, which arrive as Enter, Tab or Escape during a composition,
// reached the card's handlers as if the user had pressed them.
import { createMenuPresence } from '$lib/components/menu/menu-presence.svelte';
import { describe, it, expect, vi } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import { parse } from '$lib/core/parser';
import { createEditorEvents } from '$lib/editor-events';
import LinkCard from '$lib/components/link-card/LinkCard.svelte';
import LinkCardHost from '$lib/components/link-card/LinkCardHost.svelte';
import { createLinkCardState } from '$lib/components/link-card/link-card-state.svelte';
import type { UndoController } from '$lib/editor-actions/deps';
import type { CaretRestore } from '$lib/selection/caret-restore';
import { fixtureReading } from '../../harness/fixture-grammar';
import { defaultGrammarView } from '$lib/schema/block-openers';

function key(name: string, isComposing: boolean): KeyboardEvent {
	return new KeyboardEvent('keydown', { key: name, isComposing, bubbles: true, cancelable: true });
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
			resolveHref: (raw: string) => raw
		}
	});
	flushSync();
	const input = target.querySelector('input')!;
	return { onCommit, input, destroy: () => unmount(app) };
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
			controller: {} as UndoController,
			events: createEditorEvents(),
			getDoc: () => parse('Visit [example](https://example.com) now\n'),
			getEditorEl: () => target,
			measureRange: () => [],
			landCaret: async () => true,
			activateLink: vi.fn(),
			resolveLinkUrl: (u: string) => u,
			reading: fixtureReading(),
			grammar: defaultGrammarView,
			caretRestore: { save: vi.fn(), saveCurrent: vi.fn(), restore } as CaretRestore,
			menuPresence: createMenuPresence()
		}
	});
	card.enter({ path: [0], sourceStart: 6 });
	flushSync();
	// The card takes focus a tick after its anchor is placed, so the Escape that restores the
	// caret finds the card holding it.
	await tick();
	return { card, restore, destroy: () => unmount(app) };
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
