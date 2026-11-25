// conspiracy-plugin.ts
import {
	colonLines,
	command,
	container,
	definePlugin,
	type Block
} from '@voithos-labs/aragonite/plugin';
import './conspiracy.css';

/** The verdict is the name on the opening line: `conspiracy` or `debunked`. */
interface Verdict {
	name: string;
}

// A chord rewrites the name on the opening line, as one undo step.
const verdict = (id: string, title: string, name: string) =>
	command<Block<Verdict>>({
		id,
		title,
		run(editor, block) {
			void editor.edit().data(block, { name }).commit();
		}
	});

const conspiracy = container<Verdict>({
	name: 'conspiracy',
	label: 'Conspiracy',
	// Two names, one block type. The theory after the name is the box's title row.
	lines: colonLines({
		names: ['conspiracy', 'debunked'],
		title: { label: 'Theory', className: 'conspiracy-theory' }
	}),
	chords: {
		'Mod+7': verdict('allege', 'Allege', 'conspiracy'),
		'Mod+8': verdict('debunk', 'Debunk', 'debunked')
	},
	sample: ':::conspiracy Birds are drones\nthey never land near me\n:::\n',
	insert: { label: 'Conspiracy', icon: 'info', insert: ':::conspiracy\n\n:::\n' },
	draw(block, ctx) {
		const dom = document.createElement('div');
		dom.className = 'conspiracy-block';
		dom.append(ctx.children);
		// The stamp follows the verdict, so it lands the moment a chord commits.
		const stamp = (now: Block<Verdict>) => {
			dom.classList.toggle('debunked', now.data.name === 'debunked');
		};
		stamp(block);
		return { dom, update: stamp };
	}
});

export const conspiracyPlugin = definePlugin({
	name: 'conspiracy',
	version: '1.0.0',
	editor: '^0.11.5',
	contributes: () => ({ blocks: [conspiracy] })
});
