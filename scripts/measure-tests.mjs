// Which unit test files reach the library only through what it publishes. A file importing an
// unpublished symbol is pinned to internal shape; one importing only published symbols would
// survive a rewrite behind the entry points. A test helper's imports count as its tests' own.
import ts from 'typescript';
import { aliasPath, importedFile, publishedEntryPoints } from './lib-alias.mjs';

/**
 * A source tree read by repo-relative POSIX path: the working tree, or a commit.
 * @typedef {object} SourceTree
 * @property {string[]} files Every file under the paths the measures read.
 * @property {(file: string) => string} read
 */

/**
 * One reference from a file to library source: the imported name (`default`, `*` for a namespace
 * or a re-export of everything, `<load>` for a side-effect, dynamic or mocked import) and the file
 * exporting it under that name.
 * @typedef {{ target: string, name: string }} Ref
 */

const LIB = 'src/lib/';

/** Whether a library file is test code rather than production code. */
export const isTestPath = (/** @type {string} */ file) =>
	file.startsWith(`${LIB}test/`) ||
	file.startsWith(`${LIB}e2e/`) ||
	/\.(test|spec)\.ts$/.test(file);

/** The unit test files Vitest runs (`vitest.config.ts`, the `unit` and `deep-stack` projects). */
export const isUnitTest = (/** @type {string} */ file) =>
	file.endsWith('.test.ts') &&
	(file.startsWith(`${LIB}test/`) || file.startsWith(`${LIB}e2e/lint/`));

/**
 * The directory a library file belongs to, one level under `src/lib/` and two under `core/` and
 * `components/`; a file at the root is `(root)`.
 * @param {string} file
 */
export function moduleOf(file) {
	const parts = file.slice(LIB.length).split('/');
	if (parts.length === 1) return '(root)';
	if ((parts[0] === 'core' || parts[0] === 'components') && parts.length > 2) {
		return `${parts[0]}/${parts[1]}`;
	}
	return parts[0];
}

/**
 * The test split, overall and per module.
 * @param {SourceTree} tree
 * @param {{ exports?: Record<string, any>, name?: string }} pkg The tree's package.json.
 */
export function measureTests(tree, pkg) {
	const fileSet = new Set(tree.files);
	const entryPoints = publishedEntryPoints(pkg);
	/** @type {Map<string, string>} package specifier to entry source */
	const selfImports = new Map(
		entryPoints.map((entry) => [`${pkg.name}${entry.subpath.slice(1)}`, entry.source])
	);
	const refsOf = memo((/** @type {string} */ file) => readRefs(tree, fileSet, file, selfImports));
	const entries = new Set(entryPoints.map((entry) => entry.source));
	const published = publishedRefs(entries, refsOf);
	/** @param {Ref} ref */
	const isPublished = ({ target, name }) =>
		entries.has(target) || published.has(`${target}\0*`) || published.has(`${target}\0${name}`);

	const isHelper = (/** @type {string} */ file) => isTestPath(file) && !isUnitTest(file);
	const unitTests = tree.files.filter(isUnitTest).sort();
	/** @type {Map<string, Set<string>>} helper file to the unit tests reaching it */
	const helperReach = new Map();
	const totals = { files: unitTests.length, publishedOnly: 0, internal: 0, noLibraryImport: 0 };
	const direct = { publishedOnly: 0, internal: 0 };
	/** @type {Record<string, ModuleSplit>} */
	const byModule = {};

	for (const test of unitTests) {
		const own = refsOf(test).filter((ref) => !isTestPath(ref.target));
		/** @type {Ref[]} */
		const reached = [...own];
		const seen = new Set([test]);
		const queue = refsOf(test).filter((ref) => isHelper(ref.target));
		while (queue.length > 0) {
			const helper = /** @type {Ref} */ (queue.pop()).target;
			if (seen.has(helper)) continue;
			seen.add(helper);
			for (const ref of refsOf(helper)) {
				if (isHelper(ref.target)) queue.push(ref);
				else if (!isTestPath(ref.target)) {
					reached.push(ref);
					if (!isPublished(ref)) getOrCreate(helperReach, helper, () => new Set()).add(test);
				}
			}
		}
		if (reached.length === 0) totals.noLibraryImport++;
		else if (reached.every(isPublished)) totals.publishedOnly++;
		else totals.internal++;
		if (own.length > 0) direct[own.every(isPublished) ? 'publishedOnly' : 'internal']++;
		tally(byModule, reached, isPublished, 'internal', 'publishedOnly');
		tally(byModule, own, isPublished, 'internalDirect', 'publishedOnlyDirect');
	}

	const helpersImportingInternals = [...helperReach]
		.map(([helper, tests]) => ({ helper, tests: tests.size }))
		.sort((a, b) => b.tests - a.tests || a.helper.localeCompare(b.helper));
	return { ...totals, direct, byModule, helpersImportingInternals };
}

/**
 * @typedef {{ internal: number, publishedOnly: number, internalDirect: number,
 *   publishedOnlyDirect: number }} ModuleSplit
 */

/**
 * Counts one test file once per module it reaches: as internal if any symbol it takes from the
 * module is unpublished, else as published-only.
 * @param {Record<string, ModuleSplit>} byModule
 * @param {Ref[]} refs
 * @param {(ref: Ref) => boolean} isPublished
 * @param {keyof ModuleSplit} internalKey
 * @param {keyof ModuleSplit} publishedKey
 */
function tally(byModule, refs, isPublished, internalKey, publishedKey) {
	/** @type {Map<string, boolean>} */
	const internalByModule = new Map();
	for (const ref of refs) {
		const module = moduleOf(ref.target);
		internalByModule.set(module, (internalByModule.get(module) ?? false) || !isPublished(ref));
	}
	for (const [module, internal] of internalByModule) {
		byModule[module] ??= {
			internal: 0,
			publishedOnly: 0,
			internalDirect: 0,
			publishedOnlyDirect: 0
		};
		byModule[module][internal ? internalKey : publishedKey]++;
	}
}

// ── The published set ────────────────────────────────────────────────────────

/**
 * Every `file\0name` an entry point re-exports, following re-export chains; `file\0*` when a
 * file is re-exported whole.
 * @param {Set<string>} entries
 * @param {(file: string) => Ref[] & { exports?: Reexport[] }} refsOf
 */
function publishedRefs(entries, refsOf) {
	/** @type {Set<string>} */
	const published = new Set();
	/** @type {[string, Set<string> | null][]} */
	const queue = [...entries].map((entry) => [entry, null]);
	const visited = new Set();
	while (queue.length > 0) {
		const [file, names] = /** @type {[string, Set<string> | null]} */ (queue.pop());
		const key = `${file}\0${names === null ? '*' : [...names].sort().join(',')}`;
		if (visited.has(key)) continue;
		visited.add(key);
		for (const { target, from, as } of refsOf(file).exports ?? []) {
			if (from === '*' && as !== '*') {
				if (names !== null && !names.has(as)) continue;
				published.add(`${target}\0*`);
				queue.push([target, null]);
			} else if (from === '*') {
				if (names === null) published.add(`${target}\0*`);
				else names.forEach((name) => published.add(`${target}\0${name}`));
				queue.push([target, names]);
			} else if (names === null || names.has(as)) {
				published.add(`${target}\0${from}`);
				queue.push([target, new Set([from])]);
			}
		}
	}
	return published;
}

// ── Reading a file's imports ─────────────────────────────────────────────────

/** @typedef {{ target: string, from: string, as: string }} Reexport */

/**
 * The library refs a file makes, with its re-exports attached as `exports`: an `export { a as b }
 * from`, an `export *`, or a local `export { b }` of an imported name.
 * @param {SourceTree} tree
 * @param {Set<string>} fileSet
 * @param {string} file
 * @param {Map<string, string>} selfImports
 * @returns {Ref[] & { exports?: Reexport[] }}
 */
function readRefs(tree, fileSet, file, selfImports) {
	/** @type {Ref[] & { exports?: Reexport[] }} */
	const refs = [];
	refs.exports = [];
	if (!fileSet.has(file)) return refs;
	const source = file.endsWith('.svelte') ? svelteScripts(tree.read(file)) : tree.read(file);
	const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
	const resolve = (/** @type {ts.Expression | undefined} */ spec) =>
		spec && ts.isStringLiteral(spec)
			? resolveSpecifier(file, spec.text, fileSet, selfImports)
			: null;
	/** @type {Map<string, Ref>} local binding to what it imports */
	const locals = new Map();

	for (const statement of ast.statements) {
		if (ts.isImportDeclaration(statement)) {
			const target = resolve(statement.moduleSpecifier);
			if (target === null) continue;
			const clause = statement.importClause;
			if (!clause) refs.push({ target, name: '<load>' });
			if (clause?.name) bind(refs, locals, clause.name.text, { target, name: 'default' });
			const bindings = clause?.namedBindings;
			if (bindings && ts.isNamespaceImport(bindings)) {
				bind(refs, locals, bindings.name.text, { target, name: '*' });
			} else if (bindings) {
				for (const element of bindings.elements) {
					const name = (element.propertyName ?? element.name).text;
					bind(refs, locals, element.name.text, { target, name });
				}
			}
		} else if (ts.isExportDeclaration(statement)) {
			const target = resolve(statement.moduleSpecifier);
			const clause = statement.exportClause;
			if (statement.moduleSpecifier && target === null) continue;
			if (target !== null && (!clause || ts.isNamespaceExport(clause))) {
				refs.push({ target, name: '*' });
				refs.exports.push({ target, from: '*', as: clause ? clause.name.text : '*' });
			} else if (clause && ts.isNamedExports(clause)) {
				for (const element of clause.elements) {
					const local = (element.propertyName ?? element.name).text;
					const imported = target === null ? locals.get(local) : { target, name: local };
					if (!imported) continue;
					if (target !== null) refs.push(imported);
					refs.exports.push({
						target: imported.target,
						from: imported.name,
						as: element.name.text
					});
				}
			}
		}
	}
	const visit = (/** @type {ts.Node} */ node) => {
		const loaded = loadedSpecifier(node);
		const target = loaded ? resolve(loaded) : null;
		if (target !== null) refs.push({ target, name: '<load>' });
		if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
			const typeTarget = resolve(node.argument.literal);
			const name = node.qualifier ? leftmostName(node.qualifier) : '*';
			if (typeTarget !== null) refs.push({ target: typeTarget, name });
		}
		ts.forEachChild(node, visit);
	};
	visit(ast);
	return refs;
}

// A test that mocks a module is tied to that file as surely as one importing it.
const MODULE_CALLS = new Set([
	'mock',
	'doMock',
	'unmock',
	'doUnmock',
	'importActual',
	'importMock'
]);

/** The specifier a call loads: `import('x')`, or `vi.mock('x')` and its siblings. */
function loadedSpecifier(/** @type {ts.Node} */ node) {
	if (!ts.isCallExpression(node) || node.arguments.length === 0) return undefined;
	const callee = node.expression;
	const loads =
		callee.kind === ts.SyntaxKind.ImportKeyword ||
		(ts.isPropertyAccessExpression(callee) &&
			ts.isIdentifier(callee.expression) &&
			callee.expression.text === 'vi' &&
			MODULE_CALLS.has(callee.name.text));
	return loads ? node.arguments[0] : undefined;
}

/**
 * `A` of the qualified name `A.B.C`.
 * @param {ts.EntityName} name
 * @returns {string}
 */
function leftmostName(name) {
	return ts.isIdentifier(name) ? name.text : leftmostName(name.left);
}

/** @param {Ref[]} refs @param {Map<string, Ref>} locals @param {string} local @param {Ref} ref */
function bind(refs, locals, local, ref) {
	refs.push(ref);
	locals.set(local, ref);
}

/** A Svelte file's `<script>` blocks, which carry its imports. */
function svelteScripts(/** @type {string} */ source) {
	return [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
		.map((match) => match[1])
		.join('\n');
}

/**
 * The tree file an import names, or null for a package outside the library. The package's
 * `/dev-checks` self-import resolves to null too: it is neither published nor internal.
 * @param {string} importer
 * @param {string} specifier
 * @param {Set<string>} fileSet
 * @param {Map<string, string>} selfImports
 */
function resolveSpecifier(importer, specifier, fileSet, selfImports) {
	return importedFile(
		importer,
		specifier,
		(candidate) => fileSet.has(candidate),
		(bare) => (bare.startsWith('#') ? aliasPath(bare) : (selfImports.get(bare) ?? null))
	);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** @template T @param {(key: string) => T} compute */
function memo(compute) {
	/** @type {Map<string, T>} */
	const cache = new Map();
	return (/** @type {string} */ key) => getOrCreate(cache, key, () => compute(key));
}

/** @template K, V @param {Map<K, V>} map @param {K} key @param {() => V} create */
function getOrCreate(map, key, create) {
	if (!map.has(key)) map.set(key, create());
	return /** @type {V} */ (map.get(key));
}
