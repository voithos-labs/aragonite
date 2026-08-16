import type { FullResult, Reporter, TestCase } from '@playwright/test/reporter';

/**
 * Fails the run when the dev server's OWN console carries the `[aragonite:` sentinel — a guard
 * that fired during SSR, which no page-side watcher can see because it happened before the
 * browser existed. Limitation: with `reuseExistingServer`, a server Playwright did not launch
 * has no stream to read, so the gate binds runs that start their own server (CI always does).
 * The sentinel's taxonomy is `docs/contributing/warnings.md`.
 */

const SENTINEL = '[aragonite:';

// Browser-side warns vite relays into the server stream; the page collector already governs them.
const CLIENT_RELAY = '[vite] (client)';

// Structural to the shared demo SSR process (registration order, not a defect): GH #196.
const EXEMPT_CHANNELS = [
	'[aragonite:invariant:late-opener-registration]',
	'[aragonite:plugin-install]'
];

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
			if (!line.includes(SENTINEL) || line.includes(CLIENT_RELAY)) continue;
			if (EXEMPT_CHANNELS.some((c) => line.includes(c))) continue;
			this.fires.push(line.trimEnd());
		}
	}
}

export default ServerWarnReporter;
