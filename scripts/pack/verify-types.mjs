// Gates the published declarations in `dist`: only the `/svelte` entry's types may reach a `svelte`
// import, and no entry's may reach a stylesheet, so a React or Vue app type-checks with
// `skipLibCheck` off and no Svelte installed (G4.185). Run by verify-pack.mjs after `npm run package`.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** The entry points written for Svelte apps, whose types may name Svelte's. */
export const SVELTE_ENTRIES = new Set(['./svelte']);

/**
 * Every failed check, as a message; an empty list means the declarations pass.
 * @param {string} [root] The package root, holding package.json and dist.
 * @returns {string[]}
 */
export function verifyTypes(root = '.') {
	const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
	const failures = [];
	for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
		if (typeof target !== 'object' || !target.types) continue;
		const entry = path.join(root, target.types);
		if (!existsSync(entry)) {
			failures.push(`${subpath} has no declaration file at ${target.types}`);
			continue;
		}
		const leaks = typeLeaks(entry);
		if (SVELTE_ENTRIES.has(subpath)) {
			// The Svelte entry reaching `svelte` is what proves the walk can see an import at all.
			if (!leaks.some((leak) => isSvelte(leak.specifier))) {
				failures.push(`${subpath} reaches no svelte import, so the walk over its types is blind`);
			}
			continue;
		}
		for (const { specifier, chain } of leaks) {
			failures.push(`${subpath} reaches ${specifier} through ${chain.join(' > ')}`);
		}
	}
	return failures;
}

/**
 * Each `svelte` or stylesheet import reachable from `entry` through relative declaration imports,
 * with the chain of files that reaches it. An import no declaration file answers counts as a leak.
 * @param {string} entry A `.d.ts` file.
 * @returns {{ specifier: string, chain: string[] }[]}
 */
export function typeLeaks(entry) {
	const base = path.dirname(entry);
	/** @type {Map<string, string | null>} */
	const parent = new Map([[entry, null]]);
	const queue = [entry];
	const leaks = [];
	const chainTo = (/** @type {string} */ file) => {
		const chain = [];
		for (let at = /** @type {string | null} */ (file); at; at = parent.get(at) ?? null) {
			chain.unshift(path.relative(base, at).replaceAll('\\', '/'));
		}
		return chain;
	};
	while (queue.length > 0) {
		const file = /** @type {string} */ (queue.shift());
		for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
			if (isSvelte(specifier) || /\.css$/.test(specifier)) {
				leaks.push({ specifier, chain: chainTo(file) });
				continue;
			}
			if (!specifier.startsWith('.')) continue;
			const next = declarationFor(file, specifier);
			if (next === null) {
				leaks.push({ specifier: `${specifier} (no declaration file)`, chain: chainTo(file) });
			} else if (!parent.has(next)) {
				parent.set(next, file);
				queue.push(next);
			}
		}
	}
	return leaks;
}

// ── Internal ────────────────────────────────────────────────────────────────

const isSvelte = (/** @type {string} */ specifier) => /^svelte(\/|$)/.test(specifier);

// `from '…'`, a side-effect `import '…'`, and an inline `import('…')` type.
const IMPORT_SPECIFIER =
	/\bfrom\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

// A `/// <reference types="…" />` or `path="…"` directive, which the comment strip below removes.
const REFERENCE_DIRECTIVE = /^\s*\/\/\/\s*<reference\s+(?:types|path)\s*=\s*['"]([^'"]+)['"]/gm;

/** @param {string} code */
function importSpecifiers(code) {
	const references = [...code.matchAll(REFERENCE_DIRECTIVE)].map((match) => match[1]);
	const bare = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
	const imports = [...bare.matchAll(IMPORT_SPECIFIER)].map(
		(match) => match[1] ?? match[2] ?? match[3]
	);
	return [...references, ...imports];
}

/**
 * @param {string} from
 * @param {string} specifier
 * @returns {string | null}
 */
function declarationFor(from, specifier) {
	const target = path.resolve(path.dirname(from), specifier);
	const candidates = [
		target.replace(/\.js$/, '.d.ts'),
		`${target}.d.ts`,
		path.join(target, 'index.d.ts')
	];
	return candidates.find((file) => file.endsWith('.d.ts') && existsSync(file)) ?? null;
}
