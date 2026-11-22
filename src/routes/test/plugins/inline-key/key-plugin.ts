// `{{label}}` as an `inline()` widget an arrow selects whole: while it is selected its `key` takes
// ArrowUp and writes the label in capitals through `props.editor`, at the widget's document bytes.
import { definePlugin, inline } from '#lib/plugin.js';

const chip = inline({
	name: 'chip',
	label: 'Chip',
	prefix: '{{',
	match: /\{\{([^}\n]+)\}\}/,
	read: ([, label]) => ({ label }),
	sample: '{{chip}}',
	widget: { delete: 'select-first', arrows: 'select', click: 'none' },
	draw(target, props) {
		target.textContent = props.data.label;
		return { update: (next) => void (target.textContent = next.data.label) };
	},
	key(event, { editor, from, to, data }) {
		if (event.key !== 'ArrowUp') return false;
		void editor.edit().replace({ from, to }, `{{${data.label.toUpperCase()}}}`).commit();
		return true;
	}
});

export const inlineKeyPlugin = definePlugin({
	name: 'inline-key',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({ inlines: [chip] })
});
