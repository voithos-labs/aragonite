import { describe, it, expect } from 'vitest';
import { reconcileTaskMetadata } from '../../tree-operations';
import type { CstNode, ListItemMetadata } from '../../core/nodes';

function makeListItem(firstParagraphRaw: string, meta: ListItemMetadata): CstNode {
	return {
		kind: 'listItem',
		leadingTrivia: '',
		raw: '',
		metadata: meta,
		innerPrefix: '',
		children: [
			{
				kind: 'paragraph',
				leadingTrivia: '',
				raw: firstParagraphRaw
			}
		],
		innerSuffix: ''
	};
}

function plainMeta(): ListItemMetadata {
	return { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null };
}

function taskMeta(marker = '[ ] ', checked = false): ListItemMetadata {
	return { marker: '- ', taskItem: true, taskChecked: checked, taskMarker: marker };
}

describe('reconcileTaskMetadata', () => {
	it('promotes plain listItem whose paragraph gained `[ ] ` prefix', () => {
		const item = makeListItem('[ ] hello\n', plainMeta());
		reconcileTaskMetadata(item);
		const meta = item.metadata as ListItemMetadata;
		expect(meta.taskItem).toBe(true);
		expect(meta.taskMarker).toBe('[ ] ');
		expect(meta.taskChecked).toBe(false);
		expect(item.children![0].raw).toBe('hello\n');
	});

	it('promotes with `[x] ` prefix, marking taskChecked true', () => {
		const item = makeListItem('[x] done\n', plainMeta());
		reconcileTaskMetadata(item);
		const meta = item.metadata as ListItemMetadata;
		expect(meta.taskItem).toBe(true);
		expect(meta.taskMarker).toBe('[x] ');
		expect(meta.taskChecked).toBe(true);
		expect(item.children![0].raw).toBe('done\n');
	});

	it('promotes preserving uppercase `[X]`', () => {
		const item = makeListItem('[X] upper\n', plainMeta());
		reconcileTaskMetadata(item);
		const meta = item.metadata as ListItemMetadata;
		expect(meta.taskMarker).toBe('[X] ');
		expect(meta.taskChecked).toBe(true);
		expect(item.children![0].raw).toBe('upper\n');
	});

	it('promotes preserving multi-space variant `[x]  `', () => {
		const item = makeListItem('[x]  padded\n', plainMeta());
		reconcileTaskMetadata(item);
		const meta = item.metadata as ListItemMetadata;
		expect(meta.taskMarker).toBe('[x]  ');
		expect(item.children![0].raw).toBe('padded\n');
	});

	it('demotes task listItem when effective first line no longer matches', () => {
		// User deleted the `]` from `[x]` — effective line becomes `[x something`.
		const item = makeListItem('x something\n', taskMeta('[', false));
		// Start with a stripped state that, combined with the broken marker,
		// no longer parses as a task: taskMarker `[` + firstLine `x something`
		// = `[x something` — no match.
		reconcileTaskMetadata(item);
		const meta = item.metadata as ListItemMetadata;
		expect(meta.taskItem).toBe(false);
		expect(meta.taskMarker).toBeNull();
		expect(meta.taskChecked).toBe(false);
		// Demotion restored the taskMarker bytes into paragraph.raw so the
		// user's content survives.
		expect(item.children![0].raw).toBe('[x something\n');
	});

	it('is a no-op when canonical task item stays a task item', () => {
		const item = makeListItem('done\n', taskMeta('[x] ', true));
		reconcileTaskMetadata(item);
		const meta = item.metadata as ListItemMetadata;
		expect(meta.taskItem).toBe(true);
		expect(meta.taskMarker).toBe('[x] ');
		expect(meta.taskChecked).toBe(true);
		expect(item.children![0].raw).toBe('done\n');
	});

	it('is a no-op when plain listItem stays plain (content has no bracket)', () => {
		const item = makeListItem('hello\n', plainMeta());
		reconcileTaskMetadata(item);
		const meta = item.metadata as ListItemMetadata;
		expect(meta.taskItem).toBe(false);
		expect(meta.taskMarker).toBeNull();
		expect(item.children![0].raw).toBe('hello\n');
	});

	it('skips non-listItem input (paragraph)', () => {
		const node: CstNode = {
			kind: 'paragraph',
			leadingTrivia: '',
			raw: '[ ] text\n'
		};
		reconcileTaskMetadata(node);
		expect(node.kind).toBe('paragraph');
		expect(node.raw).toBe('[ ] text\n');
	});

	it('skips when first child is not a paragraph (e.g. nested list)', () => {
		const item: CstNode = {
			kind: 'listItem',
			leadingTrivia: '',
			raw: '',
			metadata: plainMeta(),
			children: [
				{ kind: 'list', leadingTrivia: '', raw: '', metadata: { ordered: false }, children: [] }
			]
		};
		reconcileTaskMetadata(item);
		const meta = item.metadata as ListItemMetadata;
		expect(meta.taskItem).toBe(false);
	});

	it('skips when first paragraph is empty', () => {
		const item = makeListItem('\n', plainMeta());
		reconcileTaskMetadata(item);
		const meta = item.metadata as ListItemMetadata;
		expect(meta.taskItem).toBe(false);
		expect(item.children![0].raw).toBe('\n');
	});

	it('handles paragraph raw without trailing newline (live typing state)', () => {
		const item = makeListItem('[ ] mid-typing', plainMeta());
		reconcileTaskMetadata(item);
		const meta = item.metadata as ListItemMetadata;
		expect(meta.taskItem).toBe(true);
		expect(meta.taskMarker).toBe('[ ] ');
		expect(item.children![0].raw).toBe('mid-typing');
	});

	it('updates taskChecked when existing task item has raw that flips check state', () => {
		// Marker drift: meta says [x] but effective line is `[x] task` with [x]
		// marker — stays checked. Change check state by rewriting effective.
		const item = makeListItem('  task\n', taskMeta('[x]', true));
		// Effective line: `[x]  task` — matches `[x] ` with double space.
		reconcileTaskMetadata(item);
		const meta = item.metadata as ListItemMetadata;
		expect(meta.taskItem).toBe(true);
		expect(meta.taskChecked).toBe(true);
		expect(meta.taskMarker).toBe('[x]  ');
	});
});
