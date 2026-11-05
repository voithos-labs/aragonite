/**
 * `npm create @voithos-labs/aragonite-plugin` (the package in `packages/create-aragonite-plugin`):
 * what its bin makes of a folder, what its tarball holds (G4.290), how the template's release
 * workflow may publish, and how the docs spell the command (G4.292). The bin runs as a child
 * process, the way npm runs it.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { corpusFiles } from '../../../../scripts/docs/doc-corpus.mjs';
import { CREATE_PACKAGE, TEMPLATE_DIR } from '../../../../scripts/workspace.mjs';
import { writeGrants } from '../harness/workflow-grants';
import { collectFiles } from '../invariants/lint/scan-source';

const BIN = path.resolve(CREATE_PACKAGE, 'bin/create-aragonite-plugin.mjs');
// Generous: it stops a hung child, and never times a fast one.
const SPAWN_TIMEOUT = 120_000;
const scratch = mkdtempSync(path.join(tmpdir(), 'aragonite-create-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A fresh folder to run the bin from, so no row sees another's output. */
const freshCwd = () => mkdtempSync(path.join(scratch, 'cwd-'));

const create = (cwd: string, ...args: string[]) =>
	spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', timeout: SPAWN_TIMEOUT });

/** Tracked files, plus new ones git doesn't ignore: what a checkout of this tree would hold. */
const treeFiles = (dir: string) =>
	execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', dir], {
		encoding: 'utf8',
		timeout: SPAWN_TIMEOUT
	})
		.split('\n')
		.filter((file) => file !== '' && existsSync(file))
		.map((file) => file.slice(dir.length + 1))
		.sort();

/** Every file under `dir`, dotfiles included, as posix paths from `dir`. */
function filesUnder(dir: string): string[] {
	const from = `${path.relative('.', dir).split(path.sep).join('/')}/`;
	return collectFiles(dir, { extensions: [''] }).map((file) => file.slice(from.length));
}

// ── The bin ──────────────────────────────────────────────────────────────────

describe('the create bin', () => {
	it('copies the template, restores .gitignore and names the package after the folder', () => {
		const cwd = freshCwd();
		const run = create(cwd, 'plugins/mine/my-thing');
		const made = path.join(cwd, 'plugins/mine/my-thing');

		expect(run.status, run.stderr).toBe(0);
		const expected = treeFiles(TEMPLATE_DIR).map((file) =>
			file === '_gitignore' ? '.gitignore' : file
		);
		expect(filesUnder(made)).toEqual(expected.sort());
		const template = readFileSync(`${TEMPLATE_DIR}/package.json`, 'utf8');
		expect(readFileSync(path.join(made, 'package.json'), 'utf8')).toBe(
			template.replace('"name": "aragonite-parrot"', '"name": "my-thing"')
		);
		// The folder may sit inside a repository already, so the bin leaves git alone.
		expect(existsSync(path.join(made, '.git'))).toBe(false);
		expect(run.stdout).toContain(`cd ${path.join('plugins', 'mine', 'my-thing')}\n`);
		expect(run.stdout).toMatch(/npm install\n.*npm run dev\n/);
		expect(run.stdout).toContain('README.md');
	});

	it('fills an empty folder named by `.`, the package taking that folder name', () => {
		const cwd = path.join(freshCwd(), 'empty-one');
		mkdirSync(cwd);
		const run = create(cwd, '.');

		expect(run.status, run.stderr).toBe(0);
		expect(JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8')).name).toBe('empty-one');
		expect(run.stdout).not.toContain('cd ');
	});

	it.each([
		['no folder', [], /Usage/],
		['two folders', ['a-one', 'a-two'], /Usage/],
		['a flag', ['--yes'], /Usage/],
		['a folder npm would refuse as a package name', ['My Plugin'], /package name/],
		['a character npm no longer takes in a new name', ['~mine'], /package name/],
		['a folder that already holds something', ['taken'], /isn't an empty folder/],
		['a file where the folder would go', ['note.txt'], /isn't an empty folder/]
	])('refuses %s and writes nothing', (_, args, message) => {
		const cwd = freshCwd();
		mkdirSync(path.join(cwd, 'taken'));
		writeFileSync(path.join(cwd, 'taken/keep.md'), 'mine\n');
		writeFileSync(path.join(cwd, 'note.txt'), 'mine\n');
		const run = create(cwd, ...args);

		expect(run.status).toBe(1);
		expect(run.stderr).toMatch(message);
		expect(filesUnder(cwd)).toEqual(['note.txt', 'taken/keep.md']);
	});
});

// ── The tarball ──────────────────────────────────────────────────────────────

describe('G4.290 the create package ships its bin and the template, nothing else', () => {
	// Packed from the repo root by workspace, the way the release publishes it.
	it('packs exactly the files a checkout holds, so no local build or install leaks in', () => {
		const report = JSON.parse(
			execSync(`npm pack -w ${CREATE_PACKAGE} --dry-run --json --ignore-scripts`, {
				encoding: 'utf8',
				timeout: SPAWN_TIMEOUT
			})
		);
		const results: { name: string; files: { path: string }[] }[] = Array.isArray(report)
			? report
			: Object.values(report);
		const result = results.find(({ name }) => name === '@voithos-labs/create-aragonite-plugin');
		const packed = (result?.files ?? []).map((file) => file.path).sort();

		expect(packed).toContain('template/_gitignore');
		expect(packed).toContain('template/.github/workflows/ci.yml');
		expect(packed).toEqual(treeFiles(CREATE_PACKAGE));
	});
});

// ── The template's release workflow ──────────────────────────────────────────

describe("the template's release workflow publishes on a version tag, with no stored token", () => {
	const workflow = readFileSync(`${TEMPLATE_DIR}/.github/workflows/release.yml`, 'utf8');

	it('runs on a pushed version tag and nothing else', () => {
		const triggers = workflow.split('\non:\n')[1].split(/\n(?=\S)/)[0];
		expect(triggers).toBe("  push:\n    tags: ['v*']\n");
	});

	it('asks npm for a short-lived credential, its one write grant, and reads no secret', () => {
		expect(writeGrants(workflow)).toEqual(['id-token: write']);
		expect(workflow).not.toMatch(/secrets\.|NODE_AUTH_TOKEN/);
	});
});

// ── The documented command ───────────────────────────────────────────────────

// npm keeps a copy of the starter it ran before, so without `@latest` a reader may get an old one.
describe('G4.292 every documented create command asks for @latest', () => {
	const COMMAND =
		/\b(?:npm (?:create|init) @voithos-labs\/aragonite-plugin|npx @voithos-labs\/create-aragonite-plugin)(@[\w.-]+)?/g;
	const commands = corpusFiles(['docs', 'README.md', 'CONTRIBUTING.md', 'packages'], ['.md'])
		.filter((file) => !file.startsWith('docs/changelog'))
		.flatMap((file) =>
			readFileSync(file, 'utf8')
				.split('\n')
				.flatMap((line, i) =>
					[...line.matchAll(COMMAND)].map((match) => ({ at: `${file}:${i + 1}`, tag: match[1] }))
				)
		);

	it('finds the command in the guide and in the starter package README', () => {
		const files = commands.map(({ at }) => at.replace(/:\d+$/, ''));
		expect(files).toContain('docs/guide/plugin-guide.md');
		expect(files).toContain(`${CREATE_PACKAGE}/README.md`);
	});

	it('names @latest in each', () => {
		expect(commands.filter(({ tag }) => tag !== '@latest').map(({ at }) => at)).toEqual([]);
	});
});
