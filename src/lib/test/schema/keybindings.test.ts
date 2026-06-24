// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { eventToChord, normalizeChord } from '$lib/schema/keybindings';

function ke(init: Partial<KeyboardEventInit> & { key: string }): KeyboardEvent {
	return new KeyboardEvent('keydown', init);
}

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
