/**
 * The showcase's "report a bug" link: GitHub's new-issue form for `bug.yml`, only its `where` field
 * filled from the query string (GitHub's form puts a link-filled value back over a paste). The
 * recording never rides the link: it goes on the clipboard, or downloads when too long for an issue.
 */

/** The editor's input recording, typed by the parts read here so this file imports nothing. */
export interface BugRecording {
	editor: { version: string };
	steps: readonly unknown[];
}

export const NEW_BUG_URL = 'https://github.com/voithos-labs/aragonite/issues/new';

// An issue body holds 65,536 characters; the rest of the form needs some of them.
export const MAX_BODY_RECORDING = 60_000;

export interface BugReport {
	url: string;
	/** How the recording reaches the form. */
	carrier: 'clipboard' | 'download';
	/** The recording as it goes on the clipboard (fenced) or into the downloaded file (bare JSON). */
	attachment: string;
}

export function bugReport(recording: BugRecording, where: string): BugReport {
	const json = JSON.stringify(recording);
	const fenced = '```json\n' + json + '\n```';
	const url = `${NEW_BUG_URL}?${new URLSearchParams({ template: 'bug.yml', where })}`;
	if (fenced.length <= MAX_BODY_RECORDING) return { url, carrier: 'clipboard', attachment: fenced };
	return { url, carrier: 'download', attachment: json };
}

/** "0.11.1, Chrome 141 on Windows, live mode": what the form's `where` field asks for. */
export function describeWhere(
	version: string,
	userAgent: string,
	platform: string | undefined,
	mode: string
): string {
	return `${version}, ${browserOf(userAgent)} on ${platform || osOf(userAgent)}, ${mode} mode`;
}

function browserOf(ua: string): string {
	const named = [
		['Edge', /Edg\/(\d+)/],
		['Firefox', /Firefox\/(\d+)/],
		['Chrome', /Chrome\/(\d+)/],
		['Safari', /Version\/(\d+(?:\.\d+)?).*Safari/]
	] as const;
	for (const [name, re] of named) {
		const version = re.exec(ua)?.[1];
		if (version) return `${name} ${version}`;
	}
	return 'an unknown browser';
}

function osOf(ua: string): string {
	if (/Android/.test(ua)) return 'Android';
	if (/iPhone|iPad/.test(ua)) return 'iOS';
	if (/Windows/.test(ua)) return 'Windows';
	if (/Mac OS X/.test(ua)) return 'macOS';
	if (/Linux/.test(ua)) return 'Linux';
	return 'an unknown OS';
}
