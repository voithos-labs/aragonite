export const PANEL_STORAGE_KEY = 'limestone.debug-panel.state.v1';

export type SectionKey = 'rawSource' | 'cst' | 'selection' | 'undo' | 'inline' | 'opsLog';

const SECTION_KEYS: SectionKey[] = ['rawSource', 'cst', 'selection', 'undo', 'inline', 'opsLog'];

export interface PanelStateShape {
	open: boolean;
	expanded: Record<SectionKey, boolean>;
}

export function defaultPanelState(): PanelStateShape {
	return {
		open: false,
		expanded: {
			rawSource: true,
			cst: true,
			selection: false,
			undo: false,
			inline: false,
			opsLog: true
		}
	};
}

export function readPanelState(): PanelStateShape {
	if (typeof localStorage === 'undefined') return defaultPanelState();
	const raw = localStorage.getItem(PANEL_STORAGE_KEY);
	if (!raw) return defaultPanelState();
	try {
		const parsed = JSON.parse(raw) as Partial<PanelStateShape>;
		const defaults = defaultPanelState();
		const expanded = { ...defaults.expanded };
		if (parsed.expanded) {
			for (const key of SECTION_KEYS) {
				if (typeof parsed.expanded[key] === 'boolean') expanded[key] = parsed.expanded[key]!;
			}
		}
		return {
			open: typeof parsed.open === 'boolean' ? parsed.open : defaults.open,
			expanded
		};
	} catch {
		return defaultPanelState();
	}
}

export function writePanelState(state: PanelStateShape): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(state));
}

// ── Reactive state for the panel UI ───────────────────────────────────────

export function createPanelState() {
	const initial = readPanelState();
	let state = $state<PanelStateShape>(initial);

	$effect(() => {
		writePanelState(state);
	});

	return {
		get open() {
			return state.open;
		},
		set open(v: boolean) {
			state = { ...state, open: v };
		},
		toggle() {
			state = { ...state, open: !state.open };
		},
		isExpanded(section: SectionKey) {
			return state.expanded[section];
		},
		toggleSection(section: SectionKey) {
			state = {
				...state,
				expanded: { ...state.expanded, [section]: !state.expanded[section] }
			};
		}
	};
}
