/**
 * G4.330: a key, clipboard or input handler that removes calls `preventDefault()` on its event before
 * it first awaits, so the removal's byte splice runs before the browser edits the page and no block it
 * keeps shows text the browser typed (`block-id.ts :: keepUnchangedDeep`). A handler is found by its
 * annotated event parameter, so one typed from context, or a removal a command runs, isn't seen.
 */

import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { collectEditorSources, LIBRARY_ROOTS, type SourceFile } from './scan-source';

const EVENT_TYPE = /\b(?:KeyboardEvent|ClipboardEvent|InputEvent)\b/;

/** What a removal is called as: the range replace, a block's delete, and a cut's arm. */
const REMOVALS = new Set(['replaceRange', 'deleteBlock']);
const ARM_REMOVE = /\barm\.remove$/;

/** Handlers the scan must find, so a rename or a dropped annotation can't empty it. */
const EXPECTED = [
	'src/lib/selection/cross-block/keydown.ts :: handleCrossBlockActive',
	'src/lib/components/blocks/editable/clipboard-step.ts :: runClipboardCut',
	'src/lib/editor-actions/container-block-component.ts :: handleWholeBlockKeys',
	'src/lib/components/blocks/editable/editable-leaf.ts :: handleKeydown'
];

interface Handler {
	name: string;
	line: number;
	/** Each removal call with no `preventDefault()` on the event before it and before every await. */
	unprevented: number[];
}

describe('G4.330: a handler that removes prevents the default before it awaits', () => {
	const handlers = collectEditorSources(LIBRARY_ROOTS).flatMap(handlersIn);

	it('finds every handler a key or a cut removes through', () => {
		const found = new Set(handlers.map((h) => h.name));
		expect(EXPECTED.filter((name) => !found.has(name))).toEqual([]);
	});

	it('prevents the default before every removal and before the first await', () => {
		const misses = handlers.flatMap((h) => h.unprevented.map((line) => `${h.name}:${line}`));
		expect(misses).toEqual([]);
	});
});

// ── The scan ─────────────────────────────────────────────────────────────────

function handlersIn(file: SourceFile): Handler[] {
	return scriptsOf(file).flatMap(({ text, startLine }) => {
		const source = ts.createSourceFile(file.relPath, text, ts.ScriptTarget.Latest, true);
		const { helpers, handlers } = removersIn(source);
		const line = (node: ts.Node) =>
			startLine + source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
		const found: Handler[] = [];
		visit(source, (node) => {
			const event = eventOf(node);
			if (!event || !ts.isFunctionLike(node) || !('body' in node) || !node.body) return;
			const calls = callsIn(node.body);
			const removals = calls.filter((call) => removes(call, helpers));
			// A handler handed the event prevents it itself, so the call misses only after an await.
			const handedOn = calls.filter((call) => callsLocal(call, handlers));
			if (removals.length + handedOn.length === 0) return;
			const awaits = awaitsIn(node.body);
			const awaited = (at: ts.Node) => awaits.some((a) => a.getEnd() <= at.getStart(source));
			const prevents = calls.filter((call) => isPreventDefault(call, event) && !awaited(call));
			const unprevented = [
				...removals.filter((r) => !prevents.some((p) => p.getStart(source) < r.getStart(source))),
				...handedOn.filter(awaited)
			];
			found.push({
				name: `${file.relPath} :: ${nameOf(node) ?? '(anonymous)'}`,
				line: line(node),
				unprevented: unprevented.map(line)
			});
		});
		return found;
	});
}

/** The name of `node`'s event parameter, when it's a function taking one by its annotated type. */
function eventOf(node: ts.Node): string | null {
	if (!ts.isFunctionLike(node)) return null;
	const event = node.parameters.find((p) => p.type && EVENT_TYPE.test(p.type.getText()));
	return event && ts.isIdentifier(event.name) ? event.name.text : null;
}

/** The file's TypeScript: the whole of a `.ts`, each `<script>` of a `.svelte`. */
function scriptsOf(file: SourceFile): { text: string; startLine: number }[] {
	if (!file.relPath.endsWith('.svelte')) return [{ text: file.text, startLine: 0 }];
	return [...file.text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => ({
		text: m[1],
		startLine: file.text.slice(0, m.index! + m[0].indexOf('>') + 1).split('\n').length - 1
	}));
}

/** The functions in `source` that remove, by name: `handlers` take the event and are checked on
 *  their own, `helpers` (with the removal entries) are reached without it. */
function removersIn(source: ts.SourceFile): { helpers: Set<string>; handlers: Set<string> } {
	const named = new Map<string, { body: ts.Node; takesEvent: boolean }>();
	visit(source, (node) => {
		if (!ts.isFunctionLike(node) || !('body' in node) || !node.body) return;
		const name = nameOf(node);
		if (name) named.set(name, { body: node.body, takesEvent: eventOf(node) !== null });
	});
	const helpers = new Set(REMOVALS);
	const handlers = new Set<string>();
	let grew = true;
	while (grew) {
		grew = false;
		for (const [name, { body, takesEvent }] of named) {
			if (helpers.has(name) || handlers.has(name)) continue;
			const calls = callsIn(body);
			if (!calls.some((call) => removes(call, helpers) || callsLocal(call, handlers))) continue;
			(takesEvent ? handlers : helpers).add(name);
			grew = true;
		}
	}
	return { helpers, handlers };
}

function callsLocal(call: ts.CallExpression, names: Set<string>): boolean {
	return ts.isIdentifier(call.expression) && names.has(call.expression.text);
}

function removes(call: ts.CallExpression, removers: Set<string>): boolean {
	const callee = call.expression;
	if (ts.isIdentifier(callee)) return removers.has(callee.text);
	if (!ts.isPropertyAccessExpression(callee)) return false;
	return REMOVALS.has(callee.name.text) || ARM_REMOVE.test(callee.getText());
}

function isPreventDefault(call: ts.CallExpression, event: string): boolean {
	const callee = call.expression;
	return (
		ts.isPropertyAccessExpression(callee) &&
		callee.name.text === 'preventDefault' &&
		callee.expression.getText() === event
	);
}

function callsIn(body: ts.Node): ts.CallExpression[] {
	const calls: ts.CallExpression[] = [];
	visit(body, (node) => void (ts.isCallExpression(node) && calls.push(node)));
	return calls;
}

/** The function's own awaits, not those of a function inside it. */
function awaitsIn(body: ts.Node): ts.AwaitExpression[] {
	const awaits: ts.AwaitExpression[] = [];
	const walk = (node: ts.Node): void => {
		if (ts.isAwaitExpression(node)) awaits.push(node);
		if (!ts.isFunctionLike(node)) ts.forEachChild(node, walk);
	};
	ts.forEachChild(body, walk);
	return awaits.sort((a, b) => a.pos - b.pos);
}

function nameOf(node: ts.SignatureDeclaration): string | null {
	if (node.name && ts.isIdentifier(node.name)) return node.name.text;
	const parent = node.parent;
	if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
	if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
	return null;
}

function visit(node: ts.Node, at: (node: ts.Node) => void): void {
	at(node);
	ts.forEachChild(node, (child) => visit(child, at));
}
