import { describe, it, expect, beforeEach } from 'vitest';
import {
	PANEL_STORAGE_KEY,
	MIN_PANEL_WIDTH,
	DEFAULT_PANEL_WIDTH,
	readPanelState,
	writePanelState,
	defaultPanelState,
	type PanelStateShape
} from '../../../routes/debug-panel/panel-state.svelte';

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
				opsLog: true,
				trace: false
			},
			width: 560
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

	it('defaults width when storage omits it', () => {
		localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify({ open: true }));
		expect(readPanelState().width).toBe(DEFAULT_PANEL_WIDTH);
	});

	it('clamps a stored width below the minimum up to the minimum on read', () => {
		localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify({ width: 50 }));
		expect(readPanelState().width).toBe(MIN_PANEL_WIDTH);
	});

	it('accepts a stored width above the minimum verbatim', () => {
		localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify({ width: 640 }));
		expect(readPanelState().width).toBe(640);
	});

	it('falls back to default width on a non-numeric stored value', () => {
		localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify({ width: 'wide' }));
		expect(readPanelState().width).toBe(DEFAULT_PANEL_WIDTH);
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
