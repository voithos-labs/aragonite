import { describe, it, expect } from 'vitest';
import { reconcileTaskMetadata } from '../../tree-operations';
import type { CstNode, ListItemMetadata } from '../../core/nodes';

function makeListItem(firstParagraphRaw: string, meta: ListItemMetadata): CstNode {
	return {
		kind: 'listItem',
		leadingTrivia: '',
		raw: (meta.marker ?? '') + (meta.taskMarker ?? '') + firstParagraphRaw,
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
		reconcileTaskMetadata(item, item.raw);
		const meta = item.metadata as ListItemMetadata;
		expect(meta.taskItem).toBe(true);
		expect(meta.taskMarker).toBe('[ ] ');
		expect(meta.taskChecked).toBe(false);
		expect(item.children![0].raw).toBe('hello\n');
	});

	it('promotes with `[x] ` prefix, marking taskChecked true', () => {
		const item = makeListItem('[x] done\n', plainMeta());
		reconcileTaskMetadata(item, item.raw);
		const meta = item.metadata as ListItemMetadata;
		expect(meta.taskItem).toBe(true);
		expect(meta.taskMarker).toBe('[x] ');
		expect(meta.taskChecked).toBe(true);
		expect(item.children![0].raw).toBe('done\n');
	});

	it('promotes preserving uppercase `[X]`', () => {
		const item = makeListItem('[X] upper\n', plainMeta());
		reconcileTaskMetadata(item, item.raw);
		const meta = item.metadata as ListItemMetadata;
		expect(meta.taskMarker).toBe('[X] ');
		expect(meta.taskChecked).toBe(true);
		expect(item.children![0].raw).toBe('upper\n');
	});

	it('promotes preserving multi-space variant `[x]  `', () => {
		const item = makeListItem('[x]  padded\n', plainMeta());
		reconcileTaskMetadata(item, item.raw);
		const meta = item.metadata as ListItemMetadata;
		expect(meta.taskMarker).toBe('[x]  ');
		expect(item.children![0].raw).toBe('padded\n');
	});

	it('demotes task listItem when effective first line no longer matches', () => {
		// The user deleted the `]` from `[x]`.
		const item = makeListItem('x something\n', taskMeta('[', false));
		// A stripped state that, recombined with the broken marker, no longer parses as a task.
		reconcileTaskMetadata(item, item.raw);
		const meta = item.metadata as ListItemMetadata;
		expect(meta.taskItem).toBe(false);
		expect(meta.taskMarker).toBeNull();
		expect(meta.taskChecked).toBe(false);
		// Demotion restores the taskMarker bytes into paragraph.raw so the content survives.
		expect(item.children![0].raw).toBe('[x something\n');
	});

	it('is a no-op when canonical task item stays a task item', () => {
		const item = makeListItem('done\n', taskMeta('[x] ', true));
		reconcileTaskMetadata(item, item.raw);
		const meta = item.metadata as ListItemMetadata;
		expect(meta.taskItem).toBe(true);
		expect(meta.taskMarker).toBe('[x] ');
		expect(meta.taskChecked).toBe(true);
		expect(item.children![0].raw).toBe('done\n');
	});

	it('is a no-op when plain listItem stays plain (content has no bracket)', () => {
		const item = makeListItem('hello\n', plainMeta());
		reconcileTaskMetadata(item, item.raw);
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
		reconcileTaskMetadata(node, node.raw);
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
		reconcileTaskMetadata(item, item.raw);
		const meta = item.metadata as ListItemMetadata;
		expect(meta.taskItem).toBe(false);
	});

	it('drops the marker when the first block stopped being a paragraph', () => {
		const item = makeListItem('# beta\n', taskMeta());
		item.children![0].kind = 'heading';
		item.children![0].metadata = { level: 1 };
		// The bytes before the write, where `beta` was still the paragraph the marker stood in
		// front of.
		reconcileTaskMetadata(item, '- [ ] beta\n');
		const meta = item.metadata as ListItemMetadata;
		expect(meta.taskItem).toBe(false);
		expect(meta.taskMarker).toBeNull();
		expect(meta.taskChecked).toBe(false);
		expect(item.children![0].raw).toBe('# beta\n');
	});

	// Miss-analysis: every reconcile test built the item as the editor's own write had just left
	// it, so nothing described an item that arrived from the parser already holding a heading,
	// and a rule keyed on the first child's kind alone read the two states the same.
	it('keeps the marker on an item that was loaded with a heading first block', () => {
		const item = makeListItem('# beta\n', taskMeta());
		item.children![0].kind = 'heading';
		item.children![0].metadata = { level: 1 };

		reconcileTaskMetadata(item, item.raw);

		const meta = item.metadata as ListItemMetadata;
		expect(meta.taskItem).toBe(true);
		expect(meta.taskMarker).toBe('[ ] ');
		expect(item.children![0].raw).toBe('# beta\n');
	});

	it('keeps the marker before the bare `#` a paragraph passes through on its way to `#tag`', () => {
		const item = makeListItem('#\n', taskMeta('[x] ', true));
		item.children![0].kind = 'heading';
		item.children![0].metadata = { level: 1 };
		reconcileTaskMetadata(item, '- [x] \n');
		const meta = item.metadata as ListItemMetadata;
		expect(meta.taskItem).toBe(true);
		expect(meta.taskMarker).toBe('[x] ');
		expect(meta.taskChecked).toBe(true);
	});

	it('skips when first paragraph is empty', () => {
		const item = makeListItem('\n', plainMeta());
		reconcileTaskMetadata(item, item.raw);
		const meta = item.metadata as ListItemMetadata;
		expect(meta.taskItem).toBe(false);
		expect(item.children![0].raw).toBe('\n');
	});

	it('handles paragraph raw without trailing newline (live typing state)', () => {
		const item = makeListItem('[ ] mid-typing', plainMeta());
		reconcileTaskMetadata(item, item.raw);
		const meta = item.metadata as ListItemMetadata;
		expect(meta.taskItem).toBe(true);
		expect(meta.taskMarker).toBe('[ ] ');
		expect(item.children![0].raw).toBe('mid-typing');
	});

	it('updates taskChecked when existing task item has raw that flips check state', () => {
		// Marker drift: the check state changes by rewriting the effective line, not the metadata.
		const item = makeListItem('  task\n', taskMeta('[x]', true));
		reconcileTaskMetadata(item, item.raw);
		const meta = item.metadata as ListItemMetadata;
		expect(meta.taskItem).toBe(true);
		expect(meta.taskChecked).toBe(true);
		expect(meta.taskMarker).toBe('[x]  ');
	});
});
