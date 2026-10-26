/**
 * The changelog's top bar, built from the showcase bar's pieces so the two pages read as one site:
 * the wordmark, the page's name, the release-family picker, the search shortcut, the way back to
 * the showcase and the theme switch. The page owns the state and hands each change to `update`.
 */
import { el, icon, setAttrs } from '../../../examples/showcase/bar-dom';
import { modKey, segmentedPicker, wordmark } from '../../../examples/showcase/bar-parts';
import { TOGGLES, type ShowcaseTheme } from '../../../examples/showcase/controls';

export interface ChangelogBarState {
	family: string;
	theme: ShowcaseTheme;
}

export interface ChangelogBarOptions {
	families: readonly string[];
	showcaseHref: string;
	onFamily: (family: string) => void;
	onTheme: () => void;
}

export interface ChangelogBar {
	update(state: ChangelogBarState): void;
	destroy(): void;
}

export function mountChangelogBar(
	header: HTMLElement,
	options: ChangelogBarOptions,
	initial: ChangelogBarState
): ChangelogBar {
	const families = segmentedPicker({
		values: options.families,
		label: 'Release family',
		attribute: 'family',
		classes: { group: 'changelog-families', item: 'changelog-family' },
		onPick: options.onFamily
	});

	// Pressed means dark, as the showcase's own switch; the glyph is the theme a press brings.
	const themeToggle = el('button', {
		type: 'button',
		class: 'showcase-icon-btn',
		'data-testid': TOGGLES.theme.testId,
		'aria-label': TOGGLES.theme.label,
		title: TOGGLES.theme.label
	});
	themeToggle.addEventListener('click', options.onTheme);

	header.replaceChildren(
		el(
			'div',
			{ class: 'showcase-bar' },
			el(
				'div',
				{ class: 'changelog-start' },
				wordmark(),
				el('span', { class: 'changelog-label' }, 'changelog')
			),
			families.segments,
			families.picker,
			el(
				'div',
				{ class: 'showcase-end' },
				el(
					'span',
					{ class: 'changelog-hint' },
					el('span', { class: 'showcase-kbd' }, el('kbd', {}, modKey()), el('kbd', {}, 'F')),
					'to search'
				),
				el('a', { class: 'showcase-link changelog-link', href: options.showcaseHref }, 'showcase'),
				el('span', { class: 'showcase-sep', 'aria-hidden': 'true' }),
				themeToggle
			)
		)
	);

	let state = initial;
	function paint() {
		families.paint(state.family);
		setAttrs(themeToggle, { 'aria-pressed': String(state.theme === 'dark') });
		themeToggle.replaceChildren(icon(state.theme === 'dark' ? 'sun' : 'moon', 16));
	}

	paint();
	return {
		update(next) {
			if (next.family === state.family && next.theme === state.theme) return;
			state = next;
			paint();
		},
		destroy() {
			families.close();
			header.replaceChildren();
		}
	};
}
