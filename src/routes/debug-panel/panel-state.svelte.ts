export const PANEL_STORAGE_KEY = 'aragonite.debug-panel.state.v1';

export type SectionKey = 'rawSource' | 'cst' | 'selection' | 'undo' | 'inline' | 'opsLog' | 'trace';

const SECTION_KEYS: SectionKey[] = [
	'rawSource',
	'cst',
	'selection',
	'undo',
	'inline',
	'opsLog',
	'trace'
];

export interface PanelStateShape {
	open: boolean;
	expanded: Record<SectionKey, boolean>;
	width: number;
}

export const MIN_PANEL_WIDTH = 300;
export const DEFAULT_PANEL_WIDTH = 420;

// Expanded by default = has something to show before the user has touched anything.
// Every other section reads empty until a click, an edit, or an explicit arm.
export function defaultPanelState(): PanelStateShape {
	return {
		open: false,
		expanded: {
			rawSource: true,
			cst: true,
			selection: false,
			undo: false,
			inline: false,
			opsLog: false,
			trace: false
		},
		width: DEFAULT_PANEL_WIDTH
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
		const width =
			typeof parsed.width === 'number' && Number.isFinite(parsed.width)
				? Math.max(MIN_PANEL_WIDTH, parsed.width)
				: defaults.width;
		return {
			open: typeof parsed.open === 'boolean' ? parsed.open : defaults.open,
			expanded,
			width
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
	let state = $state<PanelStateShape>(defaultPanelState());
	let hydrated = $state(false);

	// The stored state lands after hydration, never at init: the showcase is prerendered, so a
	// panel opened from storage on the first client render would not match the served markup.
	$effect(() => {
		state = readPanelState();
		hydrated = true;
	});

	// Gated on the read above, or a first write would persist the defaults over it.
	$effect(() => {
		if (!hydrated) return;
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
		},
		get width() {
			return state.width;
		},
		setWidth(px: number) {
			const clamped = Math.max(MIN_PANEL_WIDTH, px);
			if (clamped === state.width) return;
			state = { ...state, width: clamped };
		}
	};
}
