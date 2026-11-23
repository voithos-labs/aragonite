// A plugin value whose `%> [!TYPE]` container takes Mod+7 and offers a menu row, both running one
// command on the alert: the next type in the list, written into the head line; a `[!LOCKED]` alert
// refuses it. Its `[[flag on]]` line is a block picked up whole, so its row sits in the block's own
// menu. A pasted alert lands as a `:::type` callout.
import { command, container, definePlugin, lineBlock, rewrite, type Block } from '#lib/plugin.js';

interface AlertData {
	type: string;
}

const TYPES = ['NOTE', 'TIP', 'WARNING'];

export const cycleAlert = command<Block<AlertData>>({
	id: 'cycle',
	title: 'Next kind',
	when: (_editor, block) => block.data.type !== 'LOCKED',
	run(editor, block) {
		const type = TYPES[(TYPES.indexOf(block.data.type) + 1) % TYPES.length];
		void editor.edit().data(block, { type }).commit();
	}
});

export const alertType = container<AlertData>({
	name: 'alert',
	label: 'Alert',
	icon: 'text-quote',
	sample: '%> [!NOTE]\n%> x',
	insert: { label: 'Alert', icon: 'text-quote', insert: '%> [!NOTE]\n%> new\n' },
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

interface FlagData {
	on: boolean;
}

export const toggleFlag = command<Block<FlagData>>({
	id: 'toggle-flag',
	title: 'Toggle flag',
	run(editor, block) {
		void editor.edit().data(block, { on: !block.data.on }).commit();
	}
});

export const flagType = lineBlock<FlagData>({
	name: 'flag',
	label: 'Flag',
	match: /^\[\[flag (on|off)\]\]$/,
	data: (match) => ({ on: match[1] === 'on' }),
	write: (data) => `[[flag ${data.on ? 'on' : 'off'}]]`,
	sample: '[[flag off]]',
	insert: { none: 'a test block type' },
	role: 'object',
	actions: [{ label: 'Toggle flag', icon: 'check', command: toggleFlag }]
});

export const alertsPlugin = definePlugin({
	name: 'alerts',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		blocks: [alertType, flagType],
		rewrites: [
			rewrite({
				from: alertType,
				into: (block) => {
					const body = block.children.map((child) => child.text).join('');
					return `:::${block.data.type.toLowerCase()}\n${body}:::`;
				}
			})
		]
	})
});
