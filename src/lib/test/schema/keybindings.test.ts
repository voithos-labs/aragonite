// @vitest-environment jsdom
// Miss-analysis: every row built a `KeyboardEvent`, which always names a key, so no reader was
// handed the keyless keydown Chrome's autofill sends.
import { describe, it, expect } from 'vitest';
import {
	caretEdgeKey,
	endsSelectAllRun,
	eventToChord,
	isCharacterKey,
	isPasteKey,
	isSelectAllChord,
	motionKey,
	normalizeChord,
	pageKey,
	textKeyRole,
	typesCharacter
} from '#lib/schema/keybindings.js';

function ke(init: Partial<KeyboardEventInit> & { key: string }): KeyboardEvent {
	return new KeyboardEvent('keydown', init);
}

// A plain `Event` carries no `key` at all; a bare `KeyboardEvent` carries an empty one.
describe.each([
	['no key', () => new Event('keydown') as KeyboardEvent],
	['an empty key', () => new KeyboardEvent('keydown', { ctrlKey: true })]
])('a keydown naming %s reads as no key', (_name, keyless) => {
	it.each([
		['eventToChord', () => eventToChord(keyless()), null],
		['isCharacterKey', () => isCharacterKey(keyless().key), false],
		['typesCharacter', () => typesCharacter(keyless()), false],
		['textKeyRole', () => textKeyRole(keyless()), null],
		['caretEdgeKey', () => caretEdgeKey(keyless()), null],
		['motionKey', () => motionKey(keyless()), null],
		['pageKey', () => pageKey(keyless()), null],
		['isPasteKey', () => isPasteKey(keyless()), false],
		['isSelectAllChord', () => isSelectAllChord(keyless()), false],
		['endsSelectAllRun', () => endsSelectAllRun(keyless()), false]
	])('%s', (_reader, read, expected) => {
		expect(read()).toBe(expected);
	});
});

describe('eventToChord', () => {
	it('encodes Ctrl/Cmd as Mod and uppercases letters', () => {
		expect(eventToChord(ke({ key: 'b', ctrlKey: true }))).toBe('Mod+B');
		expect(eventToChord(ke({ key: 'b', metaKey: true }))).toBe('Mod+B');
	});
	it('orders modifiers Mod, Alt, Shift', () => {
		expect(eventToChord(ke({ key: 'z', ctrlKey: true, shiftKey: true }))).toBe('Mod+Shift+Z');
	});
	it('passes named keys and digits through', () => {
		expect(eventToChord(ke({ key: 'Tab', shiftKey: true }))).toBe('Shift+Tab');
		expect(eventToChord(ke({ key: '0', ctrlKey: true }))).toBe('Mod+0');
		expect(eventToChord(ke({ key: 'Enter' }))).toBe('Enter');
	});
	it('returns null for bare modifier keys', () => {
		expect(eventToChord(ke({ key: 'Control', ctrlKey: true }))).toBeNull();
		expect(eventToChord(ke({ key: 'Shift', shiftKey: true }))).toBeNull();
	});
});

describe('normalizeChord', () => {
	it('canonicalizes modifier order and key case', () => {
		expect(normalizeChord('Shift+Mod+z')).toBe('Mod+Shift+Z');
		expect(normalizeChord('Mod+b')).toBe('Mod+B');
	});
});

describe('caretEdgeKey', () => {
	it.each([
		['Home', {}, { to: 'line', side: 'start', extend: false, arrow: false }],
		['End', { shiftKey: true }, { to: 'line', side: 'end', extend: true, arrow: false }],
		['Home', { ctrlKey: true }, { to: 'block', side: 'start', arrow: false }],
		['End', { metaKey: true }, { to: 'block', side: 'end', arrow: false }],
		['End', { ctrlKey: true, shiftKey: true }, { to: 'doc', side: 'end', arrow: false }],
		['ArrowLeft', { metaKey: true }, { to: 'line', side: 'start', extend: false, arrow: true }],
		[
			'ArrowRight',
			{ metaKey: true, shiftKey: true },
			{ to: 'line', side: 'end', extend: true, arrow: true }
		],
		['ArrowUp', { metaKey: true }, { to: 'block', side: 'start', arrow: true }],
		['ArrowDown', { metaKey: true, shiftKey: true }, { to: 'doc', side: 'end', arrow: true }]
	] as const)('reads %s %o as an edge', (key, mods, edge) => {
		expect(caretEdgeKey(ke({ key, ...mods }))).toEqual(edge);
	});

	// Ctrl+Arrow is word motion on Windows and Linux, which the folded `Mod` would turn into an edge.
	it.each([
		['ArrowLeft', { ctrlKey: true }],
		['ArrowRight', { ctrlKey: true, shiftKey: true }],
		['ArrowUp', { ctrlKey: true, metaKey: true }],
		['ArrowLeft', { metaKey: true, altKey: true }],
		['ArrowLeft', {}],
		['Home', { altKey: true }],
		['PageUp', { metaKey: true }]
	] as const)('reads %s %o as no edge', (key, mods) => {
		expect(caretEdgeKey(ke({ key, ...mods }))).toBeNull();
	});
});

describe('pageKey', () => {
	it('reads PageUp and PageDown, Shift as growing a selection', () => {
		expect(pageKey(ke({ key: 'PageUp' }))).toEqual({ direction: 'up', extend: false });
		expect(pageKey(ke({ key: 'PageDown', shiftKey: true }))).toEqual({
			direction: 'down',
			extend: true
		});
	});

	// Ctrl+PageDown switches the browser's tab, so the editor leaves it alone.
	it.each([
		['PageDown', { ctrlKey: true }],
		['PageUp', { metaKey: true, shiftKey: true }],
		['PageDown', { altKey: true }],
		['ArrowDown', { shiftKey: true }]
	] as const)('reads %s %o as no page key', (key, mods) => {
		expect(pageKey(ke({ key, ...mods }))).toBeNull();
	});
});
