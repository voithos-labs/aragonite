import type { FullResult, Reporter, TestCase } from '@playwright/test/reporter';
import { warnTagOfLine } from '../dev-warn';

/**
 * Fails the run when the dev server's own console carries a dev-warning line: a check or a
 * Svelte runtime warning that fired during server rendering, which no page-side watcher can see
 * because it happened before the browser existed. With `reuseExistingServer` a server Playwright
 * did not launch has no output to read, so this binds only runs that start their own server (CI
 * always does). Which lines count is `docs/contributing/warnings.md`.
 */

// Browser-side warnings vite copies into the server output; the page watcher already covers them.
const CLIENT_RELAY = '[vite] (client)';

// Expected from the shared demo server process: registration order, not a defect (GH #196).
const EXEMPT_TAGS = ['invariant:late-opener-registration', 'plugin-install'];

class ServerWarnReporter implements Reporter {
	private readonly fires: string[] = [];

	onStdOut(chunk: string | Buffer, test?: TestCase): void {
		this.collect(chunk, test);
	}

	onStdErr(chunk: string | Buffer, test?: TestCase): void {
		this.collect(chunk, test);
	}

	async onEnd(result: FullResult): Promise<{ status?: FullResult['status'] } | undefined> {
		if (this.fires.length === 0) return undefined;
		console.error(
			`\n${this.fires.length} dev-warning line(s) reached the run from the server process:\n` +
				this.fires.join('\n')
		);
		// Only over a green run: a failure already has its own cause and status to report.
		return result.status === 'passed' ? { status: 'failed' } : undefined;
	}

	/** Output with a `test` is a spec's own, which already fails through that spec. */
	private collect(chunk: string | Buffer, test: TestCase | undefined): void {
		if (test) return;
		for (const raw of chunk.toString().split('\n')) {
			// eslint-disable-next-line no-control-regex -- vite colors its relay marker
			const line = raw.replace(/\x1b\[[0-9;]*m/g, '');
			const tag = warnTagOfLine(line);
			if (tag === null || EXEMPT_TAGS.includes(tag)) continue;
			if (line.includes(CLIENT_RELAY)) continue;
			this.fires.push(line.trimEnd());
		}
	}
}

export default ServerWarnReporter;
