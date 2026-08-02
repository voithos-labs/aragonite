/**
 * Text projections behind the panel's Selection and Inline-tree sections, plus the
 * cross-block predicate that classifies a selection for them. Shared with the
 * `/test/editor` bridge, so panel and probes never describe a selection two ways.
 */

import type { Editor } from '$lib';
import { parse } from '$lib/core/parser';
import { parseInline, getContentRange, isProseKind } from '$lib/core/inline';
import { dumpInlineTree } from '$lib/debug/inspect';
import { findBlockPathForElement } from '$lib/selection/path-lookup';
import { isBlockNode, nodeAt } from '$lib/tree-operations/node-ops';

type EditorInstance = ReturnType<typeof Editor>;

// Prefers the range's container over document.activeElement so the path still
// resolves once focus moved to the panel; the last selection still points into the editor.
export function getFocusedBlockPath(): number[] | null {
	if (typeof window === 'undefined') return null;
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0) return null;
	const node = sel.getRangeAt(0).startContainer;
	const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
	return findBlockPathForElement(el);
}

export function dumpFocusedInlineTree(source: string): string {
	const path = getFocusedBlockPath();
	if (!path) return '';
	const doc = parse(source);
	const node = nodeAt(doc, path);
	if (!node || !isBlockNode(node) || !isProseKind(node.kind)) return '';
	const range = getContentRange(node);
	const inline = parseInline(node.raw, range.start, range.end);
	return dumpInlineTree(inline);
}

// editor.getSelection()'s cross-block branch only populates while SelectionState is
// active, so single-block carets fall back to reading the native selection.
export function liveSelectionText(editor: EditorInstance | undefined): string {
	const editorSel = editor?.getSelection();
	if (editorSel && isCrossBlockSnapshot(editorSel)) {
		const fmt = (p: { path: number[]; offset: number }) => `[${p.path.join(',')}]@${p.offset}`;
		return `anchor=${fmt(editorSel.anchor)} focus=${fmt(editorSel.focus)} cross-block=true`;
	}
	if (typeof window === 'undefined') return '(no selection)';
	const nativeSel = window.getSelection();
	if (!nativeSel || nativeSel.rangeCount === 0) return '(no selection)';
	const range = nativeSel.getRangeAt(0);
	const startNode = range.startContainer;
	const endNode = range.endContainer;
	const startEl =
		startNode.nodeType === Node.TEXT_NODE ? startNode.parentElement : (startNode as Element);
	const endEl = endNode.nodeType === Node.TEXT_NODE ? endNode.parentElement : (endNode as Element);
	const startPath = findBlockPathForElement(startEl);
	const endPath = findBlockPathForElement(endEl);
	if (!startPath || !endPath) return '(no selection in editor)';
	const lines = [
		`mode=single-block${range.collapsed ? ' (caret)' : ' (range)'}`,
		`anchor=[${startPath.join(',')}] focus=[${endPath.join(',')}]`,
		// Native Range offsets are child-index counts against startContainer/endContainer,
		// not raw offsets; the `raw:` line below carries the CST-coordinate values.
		`range: startContainer=${describeNode(range.startContainer)} startOffset=${range.startOffset} endContainer=${describeNode(range.endContainer)} endOffset=${range.endOffset}`
	];
	if (editorSel) {
		const fmt = (p: { path: number[]; offset: number }) => `[${p.path.join(',')}]@${p.offset}`;
		lines.push(`raw: anchor=${fmt(editorSel.anchor)} focus=${fmt(editorSel.focus)}`);
	}
	if (!range.collapsed) {
		const selected = nativeSel.toString();
		if (selected) lines.push(`selected=${JSON.stringify(selected)}`);
	}
	return lines.join('\n');
}

export function isCrossBlockSnapshot(sel: {
	anchor: { path: number[] };
	focus: { path: number[] };
}): boolean {
	const a = sel.anchor.path;
	const f = sel.focus.path;
	if (a.length !== f.length) return true;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== f[i]) return true;
	}
	return false;
}

// ── Internal ────────────────────────────────────────────────────────────────

function describeNode(node: Node): string {
	if (node.nodeType === Node.TEXT_NODE) return '#text';
	if (node.nodeType === Node.ELEMENT_NODE) {
		const el = node as Element;
		const cls =
			typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : '';
		return el.tagName.toLowerCase() + cls;
	}
	return '#' + node.nodeType;
}
