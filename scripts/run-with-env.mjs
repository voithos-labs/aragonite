// Cross-platform env-setting launcher (`KEY=1 cmd` breaks on Windows shells):
// node scripts/run-with-env.mjs KEY=VALUE... -- command args...
import { spawnSync } from 'node:child_process';

const sep = process.argv.indexOf('--');
const env = { ...process.env };
for (const pair of process.argv.slice(2, sep)) {
	const eq = pair.indexOf('=');
	env[pair.slice(0, eq)] = pair.slice(eq + 1);
}
const [cmd, ...args] = process.argv.slice(sep + 1);

// shell:true on win32 resolves npm's .cmd shims, and also hands every argument to cmd.exe
// to re-parse. Callers append arguments this file never sees, so the precondition that
// makes that safe — plain tokens, no quoting — is checked, not asserted in prose.
const useShell = process.platform === 'win32';
const NEEDS_QUOTING = /[&|<>^"'`()%!\s]/;
if (useShell) {
	const unsafe = [cmd, ...args].filter((arg) => NEEDS_QUOTING.test(arg));
	if (unsafe.length > 0) {
		console.error(`run-with-env: these arguments need shell quoting on win32: ${unsafe.join(' ')}`);
		process.exit(1);
	}
}

const result = spawnSync(cmd, args, { stdio: 'inherit', env, shell: useShell });
process.exit(result.status ?? 1);
