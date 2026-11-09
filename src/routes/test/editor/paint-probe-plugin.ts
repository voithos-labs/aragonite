// A plugin value whose `paint` runs whatever a spec installs with `setProbePaint`, and whose scoped
// editor a spec repaints through.
import { definePlugin, type Block, type Editor, type Paint } from '#lib/plugin.js';

let paint: ((block: Block) => readonly Paint[]) | null = null;
let scoped: Editor | null = null;

export function setProbePaint(next: ((block: Block) => readonly Paint[]) | null): void {
	paint = next;
	scoped?.repaint();
}

export function probeEditor(): Editor {
	if (!scoped) throw new Error('paint probe: open the page with ?paint=on');
	return scoped;
}

export const paintProbePlugin = definePlugin({
	name: 'paint-probe',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		paint: (block) => paint?.(block) ?? [],
		setup(editor) {
			scoped = editor;
			return () => {
				if (scoped === editor) scoped = null;
			};
		}
	})
});
