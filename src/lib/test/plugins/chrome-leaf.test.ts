import { describe, it, expect, beforeEach } from 'vitest';
import { declarePluginKind } from '../../schema/plugin-kind';
import { getBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import {
	getBlockComponent,
	isBlockComponentRegistered
} from '../../schema/block-component-registry';
import { registerChromeLeaf } from '../../editor-actions/plugin-chrome-leaf';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import type { KeyBinding } from '../../schema/keybindings';

function keymapByChord(keymap: KeyBinding[] | undefined): Record<string, string> {
	return Object.fromEntries((keymap ?? []).map((b) => [b.chord, b.command]));
}

describe('registerChromeLeaf', () => {
	beforeEach(() => __resetSchemaRegistriesForTests());

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
		expect(isBlockComponentRegistered(kind)).toBe(true);
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
		registerChromeLeaf(kind, { keymap: [{ chord: 'Enter', command: 'block.split' }] });

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

		const extraProps = getBlockComponent(kind)?.extraProps;
		expect(extraProps?.({ kind, leadingTrivia: '', raw: '\n' })).toStrictEqual({
			blockClass: undefined
		});
	});
});
