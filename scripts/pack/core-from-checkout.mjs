// A Node `--import` hook that resolves the core's package name to this checkout's build, the way a
// host's install would, so a check that loads a plugin package's prebuilt never reaches the copy a
// nested worktree's `node_modules` links to.
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CORE = '@voithos-labs/aragonite';
// Resolved from a file inside the core package, Node reads the name through its own `exports`.
const INSIDE_CORE = pathToFileURL(path.join(ROOT, 'package.json')).href;

registerHooks({
	resolve: (specifier, context, nextResolve) =>
		specifier === CORE || specifier.startsWith(`${CORE}/`)
			? nextResolve(specifier, { ...context, parentURL: INSIDE_CORE })
			: nextResolve(specifier, context)
});
