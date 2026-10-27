import { describe, it, expect } from 'vitest';
import { declarePluginKind } from '#lib/schema/plugin-kind.js';
import { blockViewFor, getBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import { blockViewEntry } from '#lib/components/block-view-entry.js';
import { registerChromeLeaf } from '#lib/plugin.js';
import type { KeyBinding } from '#lib/schema/keybindings.js';
import { everyInstalledPlugin } from '#lib/schema/plugin-activation.js';

function keymapByChord(keymap: KeyBinding[] | undefined): Record<string, string> {
	return Object.fromEntries((keymap ?? []).map((b) => [b.chord, b.command]));
}

describe('registerChromeLeaf', () => {
	it('registers a context-dependent, not-mergeable editable chrome leaf + its component', () => {
		const kind = declarePluginKind('spec-chrome-leaf');
		registerChromeLeaf(kind, {
			blockClass: 'spec-chrome-leaf',
			keymap: [{ chord: 'Enter', command: 'block.split' }]
		});

		const d = getBlockKindDescriptor(kind);
		expect(d.editable).toBe(true);
		expect(d.isContainer).toBe(false);
		expect(d.supportsInline).toBe(false);
		expect(d.contextDependentKind).toBe(true);
		expect(d.mergeRole).toBe('not-mergeable');
		expect(d.keymap?.[0]).toEqual({ chord: 'Enter', command: 'block.split' });
		expect(blockViewFor(kind, everyInstalledPlugin)).toBeDefined();
	});

	it('defaults the keymap to descend-on-Enter plus the two merge chords', () => {
		const kind = declarePluginKind('spec-chrome-leaf');
		registerChromeLeaf(kind);

		expect(getBlockKindDescriptor(kind).keymap).toEqual([
			{ chord: 'Enter', command: 'chrome.descendToBody' },
			{ chord: 'Backspace', command: 'block.mergePrev' },
			{ chord: 'Delete', command: 'block.mergeNext' }
		]);
	});

	it('merges a caller keymap chord-keyed: the override wins its chord, defaults fill the rest', () => {
		const kind = declarePluginKind('spec-chrome-leaf');
		registerChromeLeaf(kind, {
			keymap: [{ chord: 'Enter', command: 'block.split' }]
		});

		const keymap = getBlockKindDescriptor(kind).keymap;
		expect(keymap).toHaveLength(3);
		expect(keymapByChord(keymap)).toEqual({
			Enter: 'block.split',
			Backspace: 'block.mergePrev',
			Delete: 'block.mergeNext'
		});
	});

	it('honors a mergeRole override', () => {
		const kind = declarePluginKind('spec-chrome-leaf');
		registerChromeLeaf(kind, { mergeRole: 'container' });

		expect(getBlockKindDescriptor(kind).mergeRole).toBe('container');
	});

	it('yields extraProps with an undefined blockClass when none is given', () => {
		const kind = declarePluginKind('spec-chrome-leaf');
		registerChromeLeaf(kind);

		const extraProps = blockViewEntry(blockViewFor(kind, everyInstalledPlugin)!).extraProps;
		expect(extraProps?.({ kind, leadingTrivia: '', raw: '\n' })).toStrictEqual({
			blockClass: undefined
		});
	});
});
