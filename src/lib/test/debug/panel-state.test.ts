import { describe, it, expect, beforeEach } from 'vitest';
import {
	PANEL_STORAGE_KEY,
	readPanelState,
	writePanelState,
	defaultPanelState,
	type PanelStateShape
} from '../../../../routes/test/editor/debug-panel/panel-state.svelte';

describe('panel-state persistence', () => {
	beforeEach(() => {
		(globalThis as unknown as { localStorage: Storage }).localStorage = createMockStorage();
	});

	it('returns default shape when storage is empty', () => {
		expect(readPanelState()).toEqual(defaultPanelState());
	});

	it('round-trips state through write + read', () => {
		const state: PanelStateShape = {
			open: true,
			expanded: {
				rawSource: true,
				cst: false,
				selection: true,
				undo: false,
				inline: true,
				opsLog: true
			}
		};
		writePanelState(state);
		expect(readPanelState()).toEqual(state);
	});

	it('falls back to defaults on malformed JSON', () => {
		localStorage.setItem(PANEL_STORAGE_KEY, '{not json');
		expect(readPanelState()).toEqual(defaultPanelState());
	});

	it('ignores unknown section keys without throwing', () => {
		localStorage.setItem(
			PANEL_STORAGE_KEY,
			JSON.stringify({ open: true, expanded: { cst: true, bogus: true } })
		);
		const result = readPanelState();
		expect(result.open).toBe(true);
		expect(result.expanded.cst).toBe(true);
		expect('bogus' in result.expanded).toBe(false);
	});

	it('preserves unset section keys at defaults on partial read', () => {
		localStorage.setItem(
			PANEL_STORAGE_KEY,
			JSON.stringify({ open: false, expanded: { cst: false } })
		);
		const result = readPanelState();
		const defaults = defaultPanelState();
		expect(result.expanded.cst).toBe(false);
		expect(result.expanded.rawSource).toBe(defaults.expanded.rawSource);
		expect(result.expanded.opsLog).toBe(defaults.expanded.opsLog);
	});
});

function createMockStorage(): Storage {
	let bag: Record<string, string> = {};
	return {
		getItem: (k) => (k in bag ? bag[k] : null),
		setItem: (k, v) => {
			bag[k] = String(v);
		},
		removeItem: (k) => {
			delete bag[k];
		},
		clear: () => {
			bag = {};
		},
		key: (i) => Object.keys(bag)[i] ?? null,
		get length() {
			return Object.keys(bag).length;
		}
	} as Storage;
}
