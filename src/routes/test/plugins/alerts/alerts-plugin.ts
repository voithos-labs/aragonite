// A plugin value whose `%> [!TYPE]` container takes Mod+7 and offers a menu row, both running one
// command on the alert: the next type in the list, written into the head line.
import { command, container, definePlugin, type Block } from '#lib/plugin.js';

interface AlertData {
	type: string;
}

const TYPES = ['NOTE', 'TIP', 'WARNING'];

export const cycleAlert = command<Block<AlertData>>({
	id: 'cycle',
	title: 'Next kind',
	run(editor, block) {
		const type = TYPES[(TYPES.indexOf(block.data.type) + 1) % TYPES.length];
		void editor.edit().data(block, { type }).commit();
	}
});

export const alertType = container<AlertData>({
	name: 'alert',
	label: 'Alert',
	sample: '%> [!NOTE]\n%> x',
	insert: { none: 'a test block type' },
	lines: {
		shape: 'marked',
		first: '%> ',
		rest: '%> ',
		reads: /^%> ?/,
		lazy: true,
		head: {
			match: /^\[!(\w+)\]$/,
			data: (match: RegExpExecArray) => ({ type: match[1] }),
			write: (data: AlertData) => `[!${data.type}]`
		}
	},
	chords: { 'Mod+7': cycleAlert },
	actions: [{ label: 'Next kind', icon: 'info', command: cycleAlert }]
});

export const alertsPlugin = definePlugin({
	name: 'alerts',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({ blocks: [alertType] })
});
