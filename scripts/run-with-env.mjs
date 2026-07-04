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
// shell:true on win32 resolves npm's .cmd shims; args here are fixed npm-script
// tokens (no spaces/metacharacters), so shell interpolation is safe.
const result = spawnSync(cmd, args, {
	stdio: 'inherit',
	env,
	shell: process.platform === 'win32'
});
process.exit(result.status ?? 1);
