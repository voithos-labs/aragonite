import type { InlineNode } from '../core/nodes';
import type { SelectionState } from '../selection/selection-state.svelte';
import type { UndoEntry } from '../contracts';
import type { OperationsLog, OperationEntry } from './operations-log';

export { dumpTree } from './dump-tree';

// ── Selection ──────────────────────────────────────────────────────────────

export function dumpSelection(state: SelectionState | null): string {
	if (!state || !state.anchor || !state.focus) return '(no selection)';
	const parts = [
		`anchor=${formatPoint(state.anchor)}`,
		`focus=${formatPoint(state.focus)}`,
		`cross-block=${state.isCrossBlock ?? false}`
	];
	if (state.isCrossBlock && state.start && state.end) {
		parts.push(`start=${formatPoint(state.start)}`);
		parts.push(`end=${formatPoint(state.end)}`);
	}
	return parts.join(' ');
}

function formatPoint(p: { path: number[]; offset: number }): string {
	return `[${p.path.join(',')}]@${p.offset}`;
}

// ── Undo stack ─────────────────────────────────────────────────────────────

export interface UndoStackLike {
	undo: UndoEntry[];
	redo: UndoEntry[];
}

export function dumpUndoStack(stack: UndoStackLike, n = 10): string {
	const now = Date.now();
	const entries = stack.undo.slice(-n).reverse();
	const lines = entries.map((e, i) => {
		const typeTag = (e as { type?: string }).type ?? 'structural';
		const selStr = e.selection ? formatUndoSelection(e.selection) : 'selection=null';
		const t = (e as { t?: number }).t;
		const dt = typeof t === 'number' ? `t=${now - t}ms` : 't=?';
		return `[${i}] type=${typeTag} ${selStr} ${dt}`;
	});
	lines.push(`undo-depth=${stack.undo.length} redo-depth=${stack.redo.length}`);
	return lines.join('\n');
}

function formatUndoSelection(sel: UndoEntry['selection']): string {
	if (!sel) return 'selection=null';
	const a = formatPoint(sel.anchor);
	const f = formatPoint(sel.focus);
	return `selection=${a}→${f}`;
}

// ── Inline tree ────────────────────────────────────────────────────────────

export function dumpInlineTree(nodes: InlineNode[] | undefined): string {
	if (!nodes || nodes.length === 0) return '';
	const lines: string[] = [];
	for (const node of nodes) renderInline(node, 0, lines);
	return lines.join('\n');
}

function renderInline(node: InlineNode, depth: number, lines: string[]): void {
	const indent = '  '.repeat(depth);
	const range = `[${node.start},${node.end}]`;
	const text = 'text' in node ? ` "${node.text}"` : '';
	const url = 'url' in node && node.url ? ` url=${JSON.stringify(node.url)}` : '';
	lines.push(`${indent}${node.kind} ${range}${text}${url}`);
	if ('children' in node && node.children) {
		for (const c of node.children) renderInline(c, depth + 1, lines);
	}
}

// ── Operations log ─────────────────────────────────────────────────────────

export function dumpOperationsLog(log: OperationsLog, n = 20): string {
	const snap = log.snapshot();
	if (snap.length === 0) return '(no operations recorded)';
	const tail = snap.slice(-n);
	const now = Date.now();
	return tail.map((e) => renderOp(e, now)).join('\n');
}

function renderOp(e: OperationEntry, now: number): string {
	const base = `[${e.t - now}ms] op=${e.op} path=[${e.path.join(',')}]`;
	const detail = renderDetail(e);
	return detail ? `${base} ${detail}` : base;
}

function renderDetail(e: OperationEntry): string {
	const d = e.detail;
	switch (e.op) {
		case 'split':
			return typeof d.at === 'number' ? `at=${d.at}` : '';
		case 'merge':
			return d.direction ? `direction=${d.direction}` : '';
		case 'updateContent':
			return typeof d.length === 'number' ? `length=${d.length}` : '';
		case 'replaceBlock':
			return typeof d.count === 'number' ? `count=${d.count}` : '';
		case 'paste':
			return `strategy=${d.strategy ?? '?'} count=${d.count ?? 0}`;
		case 'undo':
		case 'redo':
			return typeof d.toDepth === 'number' ? `to-depth=${d.toDepth}` : '';
		case 'delete':
		default:
			return '';
	}
}
