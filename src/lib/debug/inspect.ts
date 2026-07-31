/**
 * Internal debug engine — never exported from the public barrel (`src/lib/index.ts`).
 * Output format is disposable: assert on structured accessors (getSource, kinds, paths).
 */

import type { InlineNode } from '../core/nodes';
import type { SelectionState } from '../selection/selection-state.svelte';
import type { UndoEntry } from '../undo/types';
import type { OperationsLog, OperationEntry } from './operations-log';
import type { InteractionTraceEntry } from './interaction-trace';

export { dumpTree } from './dump-tree';

// ── Selection ──────────────────────────────────────────────────────────────

export function dumpSelection(state: SelectionState | null): string {
	if (!state || !state.anchor || !state.focus) return '(no selection)';
	const parts = [
		`anchor=${formatPoint(state.anchor)}`,
		`focus=${formatPoint(state.focus)}`,
		`cross-block=${state.isCrossBlock}`
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
	const entries = stack.undo.slice(-n).reverse();
	const lines = entries.map((e, i) => {
		const selStr = e.selection ? formatUndoSelection(e.selection) : 'selection=null';
		return `[${i}] ${selStr}`;
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
	const decoded =
		node.kind === 'entityReference' && node.decoded !== undefined
			? ` decoded=${JSON.stringify(node.decoded)}`
			: '';
	lines.push(`${indent}${node.kind} ${range}${text}${url}${decoded}`);
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
	const base = `[${now - e.t}ms ago] op=${e.op} path=[${e.path.join(',')}]`;
	const detail = renderDetail(e);
	return detail ? `${base} ${detail}` : base;
}

// ── Interaction trace ──────────────────────────────────────────────────────

export function dumpInteractionTrace(entries: InteractionTraceEntry[], n = 50): string {
	if (entries.length === 0) return '(no interactions recorded)';
	const tail = entries.slice(-n);
	const now = performance.now();
	return tail.map((e) => renderTraceEntry(e, now)).join('\n');
}

function renderTraceEntry(e: InteractionTraceEntry, now: number): string {
	const base = `[${Math.round(now - e.t)}ms ago] ${e.site}/${e.kind}`;
	if (!e.detail) return base;
	const detail = Object.entries(e.detail)
		.map(([k, v]) => `${k}=${v}`)
		.join(' ');
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
		case 'tableInsertRow':
			return typeof d.rowIdx === 'number' && typeof d.side === 'string'
				? `rowIdx=${d.rowIdx} side=${d.side}`
				: '';
		case 'tableDeleteRow':
			return typeof d.rowIdx === 'number' ? `rowIdx=${d.rowIdx}` : '';
		case 'tableInsertColumn':
			return typeof d.colIdx === 'number' && typeof d.side === 'string'
				? `colIdx=${d.colIdx} side=${d.side}`
				: '';
		case 'tableDeleteColumn':
			return typeof d.colIdx === 'number' ? `colIdx=${d.colIdx}` : '';
		case 'tableCycleAlignment':
			return typeof d.colIdx === 'number' ? `colIdx=${d.colIdx}` : '';
		default:
			return '';
	}
}
