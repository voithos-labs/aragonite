/**
 * An `@name` chip that follows on the click the host picked for links, for the e2e suite that drives
 * a follow widget's keys: the chip is a tab stop in every mode and holds a button of its own. The
 * harness records each follow on `window.__followedChips` and each press of the button on
 * `window.__chipButtons`. Dev and e2e harness only.
 */
import { definePlugin, inline } from '#lib/plugin.js';

type Records = '__followedChips' | '__chipButtons';

function record(list: Records, name: string): void {
	((window as Partial<Record<Records, string[]>>)[list] ??= []).push(name);
}

const chip = inline({
	name: 'chip',
	label: 'Follow chip',
	prefix: '@',
	match: /@[a-z]+/,
	read: (m) => ({ name: m[0].slice(1) }),
	sample: 'go to @home',
	widget: { delete: 'whole', arrows: 'over', click: 'follow' },
	follow: ({ name }) => record('__followedChips', name),
	draw(target, { data }) {
		const stop = document.createElement('span');
		stop.className = 'follow-chip';
		stop.tabIndex = 0;
		stop.textContent = data.name;
		const button = document.createElement('button');
		button.className = 'follow-chip-button';
		button.textContent = 'x';
		button.addEventListener('click', () => record('__chipButtons', data.name));
		stop.append(button);
		target.append(stop);
		return {};
	}
});

export const followKeysPlugin = definePlugin({
	name: 'follow-keys',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({ inlines: [chip] })
});
