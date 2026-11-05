#!/usr/bin/env node
// `npm create @voithos-labs/aragonite-plugin@latest <dir>`: copies the plugin template into <dir>
// and names the package after the folder. It asks nothing and runs nothing, git included, since
// the folder may sit inside a repository already.
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	statSync,
	writeFileSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATE = fileURLToPath(new URL('../template', import.meta.url));
// npm's rule for a new unscoped name: lowercase, URL-safe, at most 214 characters.
const PACKAGE_NAME = /^[a-z0-9~-][a-z0-9._~-]{0,213}$/;

/** @param {string} message */
function fail(message) {
	console.error(message);
	process.exit(1);
}

const args = process.argv.slice(2);
if (args.length !== 1 || args[0].startsWith('-')) {
	fail('Usage: npm create @voithos-labs/aragonite-plugin@latest <directory>');
}

const target = path.resolve(args[0]);
const name = path.basename(target);
if (!PACKAGE_NAME.test(name)) {
	fail(
		`"${name}" can't be an npm package name, and the folder's name becomes the package's. ` +
			'Use lowercase letters, digits, and - . _ (my-plugin, say).'
	);
}
if (existsSync(target) && (!statSync(target).isDirectory() || readdirSync(target).length > 0)) {
	fail(`${args[0]} already exists and isn't an empty folder, so nothing was written.`);
}

mkdirSync(target, { recursive: true });
cpSync(TEMPLATE, target, { recursive: true });
// npm never packs a `.gitignore`, so the template carries it under another name.
renameSync(path.join(target, '_gitignore'), path.join(target, '.gitignore'));
const manifestFile = path.join(target, 'package.json');
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
writeFileSync(manifestFile, JSON.stringify({ ...manifest, name }, null, '\t') + '\n');

const relative = path.relative(process.cwd(), target);
const cd = relative === '' ? [] : [`cd ${/\s/.test(relative) ? `"${relative}"` : relative}`];
console.log(
	[
		`Made ${name}, a plugin for aragonite (it's a party parrot, for now).`,
		'',
		...[...cd, 'npm install', 'npm run dev'].map((step) => `  ${step}`),
		'',
		'Then read its README.md: it goes from here to GitHub, npm and the plugin gallery.'
	].join('\n')
);
