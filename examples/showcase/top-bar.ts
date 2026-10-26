/**
 * The showcase's top bar as plain DOM, so the Svelte, React and Vue showcases mount one copy: the
 * wordmark, the presentation-mode switcher, the links, report a bug and the settings popover. The
 * host owns the state: it passes each change to `update` and hears clicks through the callbacks.
 */
import { el, icon, setAttrs } from './bar-dom';
import { REPO_URL, modKey, segmentedPicker, wordmark } from './bar-parts';
import {
	HANDLES_GATED_TITLE,
	PRESENTATION_MODES,
	TOGGLES,
	handlesGated,
	type ShowcaseMode,
	type ShowcaseToggle
} from './controls';
import { mountPopover } from './popover';
import { mountReportBug, type RecordingEditor } from './report-bug';

export type ToggleKey = keyof typeof TOGGLES;

export interface ShowcaseBarState {
	mode: ShowcaseMode;
	/** Each settings row's switch; a key left out reads as off. */
	pressed: Partial<Record<ToggleKey, boolean>>;
}

export interface ShowcaseBarOptions {
	/** Named beside the wordmark ("in React"), for a showcase not on the Svelte site. */
	framework?: string;
	changelogHref: string;
	/** The rows only this host can offer, under the shared settings. */
	tools: readonly ToggleKey[];
	onMode: (mode: ShowcaseMode) => void;
	onToggle: (key: ToggleKey) => void;
	editor: () => RecordingEditor | null | undefined;
}

export interface ShowcaseBar {
	update(state: ShowcaseBarState): void;
	destroy(): void;
}

const DOCS_URL = `${REPO_URL}/tree/main/docs`;
const SETTINGS: readonly ToggleKey[] = ['theme', 'dragHandles', 'selectionMenu', 'occurrences'];

export function mountShowcaseBar(
	header: HTMLElement,
	options: ShowcaseBarOptions,
	initial: ShowcaseBarState
): ShowcaseBar {
	let state = initial;

	// ── Mode switcher: segments when wide, a chip and a list when narrow ──
	const modes = segmentedPicker({
		values: PRESENTATION_MODES,
		label: 'Presentation mode',
		attribute: 'mode',
		classes: { group: 'showcase-modes', item: 'showcase-mode' },
		onPick: options.onMode
	});

	// ── Settings ──
	const rows = new Map<ToggleKey, { row: HTMLButtonElement; desc: HTMLElement }>();
	const settingsTrigger = el(
		'button',
		{
			type: 'button',
			class: 'showcase-icon-btn',
			'data-testid': 'showcase-settings',
			'aria-label': 'Settings',
			'aria-expanded': 'false'
		},
		icon('settings', 16)
	);
	const settings = mountPopover('showcase-popover-anchor', settingsTrigger, paint, () => {
		rows.clear();
		const divider = () => el('div', { class: 'showcase-popover-divider', role: 'separator' });
		const panel = el(
			'div',
			{ class: 'showcase-popover showcase-settings', role: 'group', 'aria-label': 'Settings' },
			...SETTINGS.map(settingRow),
			...(options.tools.length ? [divider(), ...options.tools.map(settingRow)] : []),
			divider(),
			el(
				'div',
				{ class: 'showcase-popover-foot' },
				el('span', {}, 'Search the document'),
				el('span', { class: 'showcase-kbd' }, el('kbd', {}, modKey()), el('kbd', {}, 'F'))
			),
			el(
				'div',
				{ class: 'showcase-popover-links' },
				divider(),
				el('a', { class: 'showcase-row', href: DOCS_URL }, 'docs'),
				el('a', { class: 'showcase-row', href: options.changelogHref }, 'changelog')
			)
		);
		return panel;
	});

	function settingRow(key: ToggleKey): HTMLButtonElement {
		const toggle = TOGGLES[key];
		// Named by its label alone; the line under it is the row's description.
		const descId = `showcase-desc-${key}`;
		const desc = el('span', { class: 'showcase-row-desc', id: descId });
		const row = el(
			'button',
			{
				type: 'button',
				class: 'showcase-row',
				'data-testid': toggle.testId,
				'aria-label': toggle.label,
				'aria-describedby': descId
			},
			el('span', { class: 'showcase-row-text' }, el('span', {}, toggle.label), desc),
			el('span', { class: 'showcase-switch', 'aria-hidden': 'true' })
		);
		row.addEventListener('click', () => options.onToggle(key));
		rows.set(key, { row, desc });
		return row;
	}

	// ── Assembly ──
	const report = mountReportBug({ editor: options.editor, mode: () => state.mode });
	const end = el(
		'div',
		{ class: 'showcase-end' },
		el('a', { class: 'showcase-link', href: DOCS_URL }, 'docs'),
		el('a', { class: 'showcase-link', href: options.changelogHref }, 'changelog'),
		el('span', { class: 'showcase-sep', 'aria-hidden': 'true' }),
		report.anchor,
		settings.anchor
	);
	header.replaceChildren(
		el(
			'div',
			{ class: 'showcase-bar' },
			wordmark(options.framework),
			modes.segments,
			modes.picker,
			end
		)
	);

	function paint() {
		modes.paint(state.mode);
		for (const [key, { row, desc }] of rows) {
			const gated = key === 'dragHandles' && handlesGated(state.mode) ? HANDLES_GATED_TITLE : null;
			setAttrs(row, {
				'aria-pressed': String(state.pressed[key] ?? false),
				disabled: gated !== null
			});
			const toggle: ShowcaseToggle = TOGGLES[key];
			desc.textContent = gated ?? toggle.title ?? '';
		}
	}

	paint();
	return {
		update(next) {
			// A host may hand the state over on every render of its own, a keystroke's included.
			if (sameState(state, next)) return;
			state = next;
			paint();
		},
		destroy() {
			modes.close();
			settings.close();
			report.destroy();
			header.replaceChildren();
		}
	};
}

function sameState(a: ShowcaseBarState, b: ShowcaseBarState): boolean {
	const keys = Object.keys(TOGGLES) as ToggleKey[];
	return a.mode === b.mode && keys.every((key) => !a.pressed[key] === !b.pressed[key]);
}
