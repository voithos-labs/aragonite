/**
 * A container type on fenced lines no built-in writes: `[fold]` or `[fold open]`, a `title:` line,
 * the body, `[/fold]`. One spelling opens and closes it, and its matchers read wider (any case, an
 * indent, a trailing attribute) for the body lines a write escapes, as `<details>` does.
 */
import { container, definePlugin, fencedLines } from '#lib/plugin.js';

export interface FoldData {
	open: boolean;
}

export const FOLD_LINES = fencedLines<FoldData>({
	open: /^ {0,3}\[fold( open)?(?=[\s\]])/i,
	data: (match) => ({ open: match[1] !== undefined }),
	write: (data) => (data.open ? '[fold open]' : '[fold]'),
	title: { match: /^title: (?<text>.*)$/, write: (title) => `title: ${title}` },
	close: { match: /^ {0,3}\[\/fold(?=[\s\]])/i, write: () => '[/fold]' },
	escape: (line) => line.replace('[', '\\[')
});

export const FOLD_SAMPLE = '[fold]\ntitle: T\n\nbody\n\n[/fold]\n';

export const fold = container<FoldData>({
	name: 'fold',
	label: 'Fold',
	lines: FOLD_LINES,
	interrupts: true,
	closable: { closed: (data) => !data.open, set: (data, closed) => ({ ...data, open: !closed }) },
	sample: FOLD_SAMPLE,
	insert: { none: 'a test block type' }
});

export const folds = definePlugin({
	name: 'folds',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({ blocks: [fold] })
});
