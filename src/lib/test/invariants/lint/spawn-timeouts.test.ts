/**
 * G4.272: every child process a file under `src/lib` spawns carries a `timeout` of its own, so a hung child
 * fails its test instead of holding the run. The scan is `call-site-rule.ts`.
 * Miss-analysis: no scan read spawn calls, so one hung `git init` held a unit run for 28 minutes.
 */

import { collectEditorSources, LIBRARY_ROOTS } from './scan-source';
import { describeCallSiteRules, type CallSiteRule } from './call-site-rule';

const SPAWNERS = ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'execSync'];
// `exec` and `fork` only as plain callees: on a receiver, `.exec(` is a RegExp's.
const CALLEES = [...SPAWNERS, ...SPAWNERS.map((name) => `.${name}`), 'exec', 'fork'];

// This file is in its own population, so no probe spells a call out: a literal `name(` here
// would read as a spawn.
const imported = (name: string) => `import { ${name} } from 'node:child_process';\n`;
const call = (name: string, args = "'git', ['init']") => `${name}(${args});`;
const spawned = (name: string, args?: string) => imported(name) + call(name, args);

const RULES: CallSiteRule[] = [
	{
		id: 'every child process spawned under src/lib passes a timeout',
		population: (file) => file.code.includes('child_process'),
		calls: CALLEES,
		holds: (args) => /\btimeout\s*[:,}]/.test(args),
		reason:
			'a spawn with no timeout of its own can hang the whole run: add `timeout` to its options, generous enough for a slow machine (it stops a hung child, it does not time a fast one)',
		hits: [
			spawned('execFileSync'),
			spawned('execFileSync', "'git', ['init'], { cwd }"),
			spawned('spawnSync', "'git', ['init'], { encoding: 'utf8' }"),
			spawned('exec', "'git init', options"),
			spawned('fork', "'worker.js', [], { timeoutMs: 1 }"),
			spawned('execFileSync', "'node', ['--timeout', '5']"),
			`import * as cp from 'node:child_process';\ncp.${call('spawn')}`
		],
		misses: [
			spawned('execFileSync', "'git', ['init'], { cwd, timeout: 60_000 }"),
			spawned('spawnSync', "'git', ['init'], { timeout }"),
			spawned('spawn', "'git', ['init'], { timeout, stdio: 'ignore' }"),
			spawned('execSync', "'git init',\n\t{\n\t\tcwd,\n\t\ttimeout: 60_000\n\t}"),
			`import * as cp from 'node:child_process';\ncp.${call('execFile', "'git', [], { timeout: 1 }")}`,
			`${imported('execFileSync')}// ${call('execFileSync')}`,
			call('spawn')
		]
	}
];

describeCallSiteRules(RULES, collectEditorSources(LIBRARY_ROOTS, { includeTests: true }));
