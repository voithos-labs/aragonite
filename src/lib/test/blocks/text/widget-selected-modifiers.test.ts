// @vitest-environment jsdom
//
// The selected-widget keydown handler's swallow contract, on two axes it read
// wrong. (1) It answered "consumed" for every unclaimed key while leaving the
// event cancellable, so the browser's own default still ran against the
// contenteditable — the block's keydown chain was skipped AND native mutated the
// DOM behind the CST. (2) Its destructive arm read only `e.key`, so the platform
// word-delete chord deleted the whole widget, the same shape as the caret-edge
// arm's fixed modifier blindness (edge-policy-modifiers.test.ts).
//
// The keymap dispatch that owns undo/redo and every bound command sits AFTER this
// handler in the chain, so "consumed" must stay narrow enough to let a chord reach it.
import { describe, it, expect, beforeAll } from 'vitest';
import { augmentInlineWidgetKind } from '$lib/core/inline/inline-widgets';
import { imageWidgetOnSelectedKey } from '$lib/components/image/image-widget-editing';
import { harness } from './widget-selected-fixture';

beforeAll(() => {
	augmentInlineWidgetKind('image', { onSelectedKey: imageWidgetOnSelectedKey });
});

function key(name: string, modifiers: Partial<KeyboardEvent> = {}): KeyboardEvent {
	return new KeyboardEvent('keydown', { key: name, cancelable: true, ...modifiers });
}

const SOURCE = 'hello ![a](u) world\n';
const WIDGET_START = 6;

describe('an unclaimed key is swallowed with its default cancelled', () => {
	// Every key the arms above do not claim. Each one's native default mutates the
	// contenteditable or moves focus out of it while the widget stays selected.
	it.each(['Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'PageDown', 'Home'])(
		'%s reports consumed and is preventDefault-ed',
		async (name) => {
			const b = harness(SOURCE, WIDGET_START);
			const e = key(name);

			expect(await b.interaction.handleSelectedWidgetKeydown(e)).toBe(true);
			expect(e.defaultPrevented).toBe(true);
			expect(b.commits).toEqual([]);
		}
	);
});

describe('a platform chord is not a widget gesture', () => {
	const chords: Partial<KeyboardEvent>[] = [{ ctrlKey: true }, { metaKey: true }];

	// Declining is what lets the chord reach the keymap dispatch further down the
	// chain; swallowing it would leave undo dead for as long as a widget is selected.
	it.each(chords)('Z with %o declines so the keymap can bind it', async (mods) => {
		const b = harness(SOURCE, WIDGET_START);
		const e = key('z', mods);

		expect(await b.interaction.handleSelectedWidgetKeydown(e)).toBe(false);
		expect(e.defaultPrevented).toBe(false);
		expect(b.commits).toEqual([]);
	});

	it.each(chords)('Backspace with %o deletes nothing', async (mods) => {
		const b = harness(SOURCE, WIDGET_START);
		const e = key('Backspace', mods);

		expect(await b.interaction.handleSelectedWidgetKeydown(e)).toBe(false);
		expect(b.commits).toEqual([]);
	});

	// Arrows are the deliberate exception: selecting the widget cleared the native
	// range, so a shared-pipeline arm reading the caret would see offset 0 and move
	// focus to a block that is not there. They stay swallowed, chord or not.
	it.each(['ArrowLeft', 'ArrowRight'])('%s with a chord stays swallowed', async (name) => {
		const b = harness(SOURCE, WIDGET_START);
		const e = key(name, { ctrlKey: true });

		expect(await b.interaction.handleSelectedWidgetKeydown(e)).toBe(true);
		expect(e.defaultPrevented).toBe(true);
	});
});

// Non-vacuity: the unmodified keys still do their destructive work, so the guard
// narrows the arms rather than disabling them.
describe('the same keys without a chord still act', () => {
	it.each(['Backspace', 'Delete'])('%s deletes the selected widget', async (name) => {
		const b = harness(SOURCE, WIDGET_START);

		expect(await b.interaction.handleSelectedWidgetKeydown(key(name))).toBe(true);
		expect(b.commits).toHaveLength(1);
		expect(b.commits[0].raw).toBe('hello  world\n');
	});

	it('a printable key replaces the selected widget', async () => {
		const b = harness(SOURCE, WIDGET_START);

		expect(await b.interaction.handleSelectedWidgetKeydown(key('x'))).toBe(true);
		expect(b.commits).toHaveLength(1);
		expect(b.commits[0].raw).toBe('hello x world\n');
	});
});
