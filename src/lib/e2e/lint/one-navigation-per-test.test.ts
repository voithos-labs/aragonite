/**
 * G4.237: a test never navigates a page its `beforeEach` already navigated. A test that needs
 * another URL gets its own describe with its own navigating `beforeEach`. A navigation is a call to
 * `gotoReady`, `reloadReady` or `gotoUnhydrated`, or to any e2e helper that reaches one, found by
 * name.
 */
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { collectFiles, readSource } from '../../test/invariants/lint/scan-source';

const NAVIGATIONS = ['gotoReady', 'reloadReady', 'gotoUnhydrated'];

// Each a test that navigates again on purpose, by path and title.
const ALLOWED: Record<string, string> = {
	'src/lib/e2e/tests/debug-panel.spec.ts::panel open state survives a page reload':
		'the row is about what a reload keeps'
};

const helperFiles = collectFiles('src/lib/e2e', { extensions: ['.ts'] })
	.filter((p) => !p.startsWith('src/lib/e2e/lint/'))
	.map(readSource);

function parse(relPath: string, text: string): ts.SourceFile {
	return ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true);
}

/** The name a call reaches: `f` for `f()`, `m` for `x.m()`. */
function calleeName(call: ts.CallExpression): string | null {
	const callee = call.expression;
	if (ts.isIdentifier(callee)) return callee.text;
	if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
	return null;
}

/** `test.describe`, `test.beforeEach`: the dotted name of a call's callee. */
function dottedName(call: ts.CallExpression): string {
	const parts: string[] = [];
	let node: ts.Expression = call.expression;
	while (ts.isPropertyAccessExpression(node)) {
		parts.unshift(node.name.text);
		node = node.expression;
	}
	if (ts.isIdentifier(node)) parts.unshift(node.text);
	return parts.join('.');
}

function callsIn(node: ts.Node): string[] {
	const names: string[] = [];
	const visit = (n: ts.Node) => {
		if (ts.isCallExpression(n)) {
			const name = calleeName(n);
			if (name) names.push(name);
		}
		ts.forEachChild(n, visit);
	};
	visit(node);
	return names;
}

/** Each function and method declared in `source`, by name, with the names its body calls. */
function declarations(source: ts.SourceFile): Map<string, string[][]> {
	const bodies = new Map<string, string[][]>();
	const record = (name: string, body: ts.Node | undefined) => {
		if (body) bodies.set(name, [...(bodies.get(name) ?? []), callsIn(body)]);
	};
	const visit = (n: ts.Node) => {
		if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name)
			record(n.name.getText(), n.body);
		if (
			(ts.isVariableDeclaration(n) || ts.isPropertyAssignment(n)) &&
			n.initializer &&
			(ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))
		)
			record(n.name.getText(), n.initializer.body);
		ts.forEachChild(n, visit);
	};
	visit(source);
	return bodies;
}

/** `known` plus every declared name whose body reaches one of them. */
function closeOver(bodies: Map<string, string[][]>, known: Set<string>): Set<string> {
	const found = new Set(known);
	for (let grew = true; grew;) {
		grew = false;
		for (const [name, calls] of bodies)
			if (!found.has(name) && calls.some((list) => list.some((call) => found.has(call)))) {
				found.add(name);
				grew = true;
			}
	}
	return found;
}

/** The shared helpers' navigating names; a spec's own declarations are read per spec. */
function helperNavigations(): Set<string> {
	const bodies = new Map<string, string[][]>();
	for (const file of helperFiles.filter((f) => !f.relPath.endsWith('.spec.ts')))
		for (const [name, calls] of declarations(parse(file.relPath, file.code)))
			bodies.set(name, [...(bodies.get(name) ?? []), ...calls]);
	return closeOver(bodies, new Set(NAVIGATIONS));
}

interface Renavigation {
	at: string;
	title: string;
	/** The call in the test that navigates. */
	via: string;
}

const isDescribe = (name: string) =>
	/^test\.describe(?:\.(?:only|skip|fixme|serial|parallel))?$/.test(name);
const isTest = (name: string) => /^test(?:\.(?:only|skip|fixme|fail|slow))?$/.test(name);
const isBeforeEach = (name: string) => /^(?:test\.)?beforeEach$/.test(name);

/** Tests in `relPath` that navigate inside a describe chain whose `beforeEach` already did. */
export function renavigations(relPath: string, code: string, helpers: Set<string>): Renavigation[] {
	const source = parse(relPath, code);
	const found: Renavigation[] = [];
	// A spec's own `open` or `load` shadows a shared helper of that name.
	const local = declarations(source);
	const inherited = new Set([...helpers].filter((name) => !local.has(name)));
	const navigating = closeOver(local, inherited);
	const navigation = (node: ts.Node) => callsIn(node).find((name) => navigating.has(name));
	const callback = (call: ts.CallExpression) =>
		call.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a)) as
			ts.ArrowFunction | ts.FunctionExpression | undefined;

	/** Whether a hook directly in this scope (not in a nested describe or test) navigates. */
	function hookNavigates(scope: ts.Node): boolean {
		let hit = false;
		const visit = (n: ts.Node) => {
			if (hit) return;
			if (ts.isCallExpression(n)) {
				const name = dottedName(n);
				if (isDescribe(name) || isTest(name)) return;
				if (isBeforeEach(name)) {
					hit = navigation(n) !== undefined;
					return;
				}
			}
			ts.forEachChild(n, visit);
		};
		ts.forEachChild(scope, visit);
		return hit;
	}

	function walk(node: ts.Node, navigated: boolean): void {
		if (ts.isCallExpression(node)) {
			const name = dottedName(node);
			const fn = callback(node);
			if (isDescribe(name) && fn) {
				walk(fn.body, navigated || hookNavigates(fn.body));
				return;
			}
			if (isTest(name) && fn) {
				const via = navigated ? navigation(fn.body) : undefined;
				if (via) {
					const { line } = source.getLineAndCharacterOfPosition(node.getStart());
					const title = node.arguments[0];
					found.push({
						at: `${relPath}:${line + 1}`,
						title: title && ts.isStringLiteralLike(title) ? title.text : (title?.getText() ?? ''),
						via
					});
				}
				return;
			}
		}
		ts.forEachChild(node, (child) => walk(child, navigated));
	}

	walk(source, hookNavigates(source));
	return found;
}

describe('G4.237 a test never navigates a page its beforeEach already navigated', () => {
	const navigating = helperNavigations();

	it('finds the navigation helpers by name', () => {
		for (const name of ['goto', 'gotoPlugins', 'loadDiagram']) expect(navigating).toContain(name);
		expect(navigating).not.toContain('loadContent');
	});

	it('no spec navigates again inside a test', () => {
		const offenders = helperFiles
			.filter((file) => file.relPath.endsWith('.spec.ts'))
			.flatMap((file) => renavigations(file.relPath, file.code, navigating))
			.filter(({ at, title }) => !(`${at.replace(/:\d+$/, '')}::${title}` in ALLOWED))
			.map(({ at, title, via }) => `${at} "${title}" calls ${via}()`);

		expect(
			offenders,
			'Give a test that needs another URL its own describe, with a beforeEach that navigates once'
		).toEqual([]);
	});

	it('every allowed test still navigates again', () => {
		const files = new Map(helperFiles.map((file) => [file.relPath, file.code]));
		for (const key of Object.keys(ALLOWED)) {
			const [path, title] = key.split('::');
			const hits = renavigations(path, files.get(path) ?? '', navigating);
			expect(
				hits.map((hit) => hit.title),
				key
			).toContain(title);
		}
	});

	const spec = (body: string) => renavigations('x.spec.ts', body, navigating);

	it('flags a navigation in a test under a navigating beforeEach, nested describes included', () => {
		const flagged = spec(
			[
				"test.describe('a', () => {",
				'  test.beforeEach(async () => { await editor.goto(); });',
				"  test.describe('b', () => {",
				"    test('t', async () => { await editor.goto('?q'); });",
				'  });',
				'});'
			].join('\n')
		);
		expect(flagged).toEqual([{ at: 'x.spec.ts:4', title: 't', via: 'goto' }]);
	});

	it("reads a spec's own helper over a shared one of the same name", () => {
		const flagged = spec(
			[
				'async function goto() { await editor.loadContent(""); }',
				"test.describe('a', () => {",
				'  test.beforeEach(async () => { await gotoReady(page, "/test/editor"); });',
				"  test('t', async () => { await goto(); });",
				'});'
			].join('\n')
		);
		expect(flagged).toEqual([]);
	});

	it('spares a test in a sibling describe, and a beforeEach that only loads content', () => {
		const flagged = spec(
			[
				"test.describe('a', () => {",
				'  test.beforeEach(async () => { await editor.goto(); });',
				"  test('t', async () => { await editor.loadContent('x'); });",
				'});',
				"test.describe('b', () => {",
				"  test.beforeEach(async () => { await editor.goto('?q'); });",
				"  test('u', async () => { await editor.loadContent('y'); });",
				'});',
				"test.describe('c', () => {",
				"  test.beforeEach(async () => { await editor.loadContent('z'); });",
				"  test('v', async () => { await editor.goto(); });",
				'});'
			].join('\n')
		);
		expect(flagged).toEqual([]);
	});
});
