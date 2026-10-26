/**
 * The pieces every top bar on the demo site builds from: the wordmark and the segmented picker.
 * `top-bar.ts` assembles the showcase's bar from them, `src/routes/changelog/changelog-bar.ts` the
 * changelog's.
 */
import { el, icon, setAttrs } from './bar-dom';
import { mountPopover } from './popover';

export const REPO_URL = 'https://github.com/voithos-labs/aragonite';

/** The aragonite wordmark, linking to the repository; `framework` is named beside it. */
export function wordmark(framework?: string): HTMLAnchorElement {
	const link = el(
		'a',
		{
			class: 'showcase-wordmark',
			href: REPO_URL,
			'aria-label': 'aragonite on GitHub',
			title: 'aragonite on GitHub'
		},
		'aragonite'
	);
	if (framework) link.append(el('span', { class: 'showcase-framework' }, `in ${framework}`));
	link.append(icon('github', 14));
	return link;
}

export interface SegmentedPickerOptions<T extends string> {
	values: readonly T[];
	/** Names the control for assistive tech, as "Presentation mode" does. */
	label: string;
	/** Each value rides on `data-<attribute>`. */
	attribute: string;
	/** The host's hooks: `group` on the track, `item` on each segment and, suffixed `-picker`,
	 *  `-trigger`, `-list` and `-option`, on the narrow form's parts. */
	classes: { group: string; item: string };
	onPick: (value: T) => void;
}

export interface SegmentedPicker<T extends string> {
	/** The wide form: one segment per value. */
	segments: HTMLElement;
	/** The narrow form: a chip naming the current value, which opens the list of them. */
	picker: HTMLElement;
	paint(current: T): void;
	close(): void;
}

/** A segmented control with a chip-and-list twin; the host's stylesheet shows one per width. */
export function segmentedPicker<T extends string>(
	options: SegmentedPickerOptions<T>
): SegmentedPicker<T> {
	const { values, label, attribute, classes, onPick } = options;
	const data = `data-${attribute}`;
	let current = values[0];

	const segmentEls = values.map((value) => {
		const segment = el(
			'button',
			{ type: 'button', class: `showcase-segment ${classes.item}`, [data]: value },
			value
		);
		segment.addEventListener('click', () => onPick(value));
		return segment;
	});
	const segments = el(
		'div',
		{ class: `showcase-segments ${classes.group}`, role: 'group', 'aria-label': label },
		...segmentEls
	);

	const triggerLabel = el('span');
	const trigger = el(
		'button',
		{
			type: 'button',
			class: `showcase-picker-trigger ${classes.item}-trigger`,
			'aria-expanded': 'false'
		},
		triggerLabel,
		icon('chevron', 14)
	);
	const list = mountPopover(
		`showcase-picker ${classes.item}-picker`,
		trigger,
		() => paint(current),
		() =>
			el(
				'div',
				{
					class: `showcase-popover showcase-picker-list ${classes.item}-list`,
					role: 'group',
					'aria-label': label
				},
				...values.map((value) => {
					const option = el(
						'button',
						{
							type: 'button',
							class: `showcase-row showcase-picker-option ${classes.item}-option`,
							[data]: value
						},
						value
					);
					option.addEventListener('click', () => {
						onPick(value);
						list.close();
					});
					return option;
				})
			)
	);

	function paint(next: T) {
		current = next;
		for (const segment of segmentEls) {
			setAttrs(segment, { 'aria-pressed': String(segment.getAttribute(data) === current) });
		}
		triggerLabel.textContent = current;
		setAttrs(trigger, { 'aria-label': `${label}: ${current}` });
		for (const option of list.panel?.querySelectorAll<HTMLElement>(`[${data}]`) ?? []) {
			const picked = option.getAttribute(data) === current;
			setAttrs(option, { 'aria-pressed': String(picked) });
			option.querySelector('svg')?.remove();
			if (picked) option.append(icon('check', 14));
		}
	}

	return { segments, picker: list.anchor, paint, close: list.close };
}

/** The platform's name for the modifier in a shortcut. */
export function modKey(): string {
	return /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
}
