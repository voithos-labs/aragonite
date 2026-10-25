// Builds what the fix-up rebuild's blind side receives and what its checks are proven against:
// the parser it reads with (`host.mjs`, scrubbed), today's fix-up behind the rebuilt package's
// entry points (`today.mjs`, never shipped), and the recorded rows as the bundle's data.
//
//   node scripts/fixup-bundle/build.mjs --bundle <dir> --dirty <dir> --rows <recorded.jsonl>
//
// `--rows` is what `FIXUP_ROWS=<file> npx vitest run src/lib/test/fixup-rows` wrote.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { scrub } from './scrub.mjs';
import { writePublishedSurface } from './published-surface.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lib = path.join(root, 'src', 'lib');
const args = process.argv.slice(2);
const option = (flag) => {
	const at = args.indexOf(flag);
	if (at < 0) throw new Error(`missing ${flag}`);
	return path.resolve(args[at + 1]);
};
const bundle = option('--bundle');
const dirty = option('--dirty');
const rows = option('--rows');
fs.mkdirSync(path.join(bundle, 'host'), { recursive: true });
fs.mkdirSync(path.join(bundle, 'data'), { recursive: true });
fs.mkdirSync(dirty, { recursive: true });

const FIXUP_FILES =
	/(settle|neighbour-merge|blank-runs|unfinished-readings|open-tail|keep-one-block|chain-rebuild|ancestry-folds)\.ts$/;
const stripped = { '@voithos-labs/aragonite/dev-checks': path.join(lib, 'dev-checks-stripped.ts') };

// ── The host ─────────────────────────────────────────────────────────────────

async function buildHost(outfile, minify) {
	const result = await build({
		entryPoints: [path.join(lib, 'test', 'fixup-rows', 'host-facade.ts')],
		bundle: true,
		format: 'esm',
		platform: 'neutral',
		charset: 'utf8',
		legalComments: 'none',
		metafile: true,
		logLevel: 'error',
		alias: stripped,
		outfile,
		...(minify ? { minify: true, mangleProps: /^(lineAt|trivia|markActivation)$/ } : {})
	});
	const inputs = Object.keys(result.metafile.inputs);
	const fixup = inputs.filter((file) => FIXUP_FILES.test(file));
	if (fixup.length > 0) throw new Error(`the host pulled in fix-up files: ${fixup.join(', ')}`);
	return inputs.length;
}

const minified = path.join(dirty, 'host-minified.mjs');
const modules = await buildHost(minified, true);
await buildHost(path.join(dirty, 'host-plain.mjs'), false);
const { code, emptied } = scrub(fs.readFileSync(minified, 'utf8'));
fs.writeFileSync(path.join(bundle, 'host', 'host.mjs'), code);
console.log(
	`host: ${modules} modules, no fix-up file, ${emptied} prose literals emptied, no comment`
);

// ── Today's fix-up behind the package's entry points ─────────────────────────

await build({
	entryPoints: [path.join(lib, 'test', 'fixup-rows', 'today-package.ts')],
	bundle: true,
	format: 'esm',
	platform: 'neutral',
	logLevel: 'error',
	alias: stripped,
	outfile: path.join(dirty, 'today.mjs')
});
console.log(`today: ${path.join(dirty, 'today.mjs')}`);

// ── The published names, for the contamination lint ──────────────────────────

const declarations = writePublishedSurface(
	path.join(root, 'dist'),
	path.join(dirty, 'published-surface.d.ts')
);
console.log(
	`published surface: ${declarations} declarations (from dist; run npm run package first)`
);

// ── The rows ─────────────────────────────────────────────────────────────────

/** A row as the bundle ships it: no word of how today's editor reached it. */
const shipped = ({ via: _via, ...row }) => {
	if (row.entry === 'mergeJoins' && row.args.floor !== undefined) {
		const { floor: _floor, ...rest } = row.args;
		return { ...row, args: rest };
	}
	return row;
};

const CHUNK = 20000;
const byEntry = new Map();
const dirtyRows = fs.createWriteStream(path.join(dirty, 'recorded.jsonl'));
for (const line of fs.readFileSync(rows, 'utf8').split('\n')) {
	if (!line) continue;
	const row = JSON.parse(line);
	dirtyRows.write(line + '\n');
	const list = byEntry.get(row.entry) ?? [];
	list.push(JSON.stringify(shipped(row)));
	byEntry.set(row.entry, list);
}
dirtyRows.end();
for (const file of fs.readdirSync(path.join(bundle, 'data'))) {
	if (file.startsWith('recorded-')) fs.rmSync(path.join(bundle, 'data', file));
}
for (const [entry, lines] of byEntry) {
	for (let i = 0; i * CHUNK < lines.length; i++) {
		const name = `recorded-${entry}-${String(i + 1).padStart(2, '0')}.jsonl`;
		fs.writeFileSync(
			path.join(bundle, 'data', name),
			lines.slice(i * CHUNK, (i + 1) * CHUNK).join('\n') + '\n'
		);
	}
	console.log(`rows: ${entry} ${lines.length}`);
}

// ── Named examples and the must-fix rows ─────────────────────────────────────

const named = fs
	.readFileSync(`${rows}.named`, 'utf8')
	.split('\n')
	.filter(Boolean)
	.map((line) => JSON.parse(line));
fs.writeFileSync(
	path.join(dirty, 'named.jsonl'),
	named.map((row) => JSON.stringify(row)).join('\n') + '\n'
);
const examples = named.filter((row) => !row.name.startsWith('must-fix'));
fs.writeFileSync(
	path.join(bundle, 'data', 'named.jsonl'),
	examples.map((row) => JSON.stringify(shipped(row))).join('\n') + '\n'
);
console.log(`named examples: ${examples.length} rows`);

const { host } = await import(pathToFileURL(path.join(dirty, 'host-plain.mjs')).href);
const projection = await import(
	pathToFileURL(path.join(bundle, 'checks', 'support', 'projection.ts')).href
);
const mustFix = [];
for (const label of [
	...new Set(named.filter((row) => row.name.startsWith('must-fix')).map((row) => row.name))
]) {
	const culprit = named
		.filter((row) => row.name === label)
		.map(asMustFix)
		.find(Boolean);
	if (!culprit) throw new Error(`${label}: no row of today's calls is wrong`);
	mustFix.push(culprit);
}
fs.writeFileSync(
	path.join(bundle, 'data', 'must-fix.jsonl'),
	mustFix.map((row) => JSON.stringify(shipped(row))).join('\n') + '\n'
);
console.log(`must-fix rows: ${mustFix.length}`);

/** The row as a must-fix row when today's answer there is wrong: what a reload reads, or whether
 *  the document's bytes end without a line ending. */
function asMustFix(row) {
	const node = (i) => row.pool[i];
	if (row.entry === 'lastLineOpen') {
		const document = row.args.document;
		const bytes =
			document.prefix +
			document.children.map((i) => node(i).leadingTrivia + node(i).raw).join('') +
			document.suffix;
		const open = bytes !== '' && !bytes.endsWith('\n');
		return open === row.expect.open ? null : { ...row, expect: { open } };
	}
	if (row.entry !== 'fixUpList' || row.args.list.owner) return null;
	const state = { children: row.expect.children, suffix: row.expect.suffix };
	// An emptied document keeps one empty paragraph, which no reading of no bytes builds.
	if (projection.listBytes(state) === '') return null;
	const reload = projection.reloadOf(state, host);
	const differs = projection.listDifference(state, reload, undefined, host);
	if (!differs) return null;
	return {
		...row,
		expect: { bytes: projection.listBytes(state), readsBack: true, today: differs }
	};
}
