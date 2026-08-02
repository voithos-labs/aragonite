# Security policy

## Supported versions

aragonite is pre-1.0. Fixes land on the latest release only; there are no maintenance branches, and there won't be until the API freeze at 1.0.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: the **Security** tab, then **Report a vulnerability**. That opens a private thread with the maintainers. If it isn't available to you, email daniel.zf.liu@gmail.com instead.

Please don't open a public issue for something exploitable. Ordinary defects (including crashes you can't weaponize) are better off in the [issue tracker](https://github.com/voithos-labs/aragonite/issues), where more people can see them. There is one maintainer, so a reply may take a few days, but a report with a working repro jumps the queue.

## What is in scope

aragonite is a library, not a service. It runs inside the embedding app's origin and parses Markdown that the app's users hand it, which may well be Markdown they didn't write. That makes three shapes of report interesting:

- **Parser and renderer crashes** on crafted input, including hangs and pathological blowups. The parser is total by contract (any line no rule claims is still absorbed as paragraph text), so input that kills or stalls it is a defect, not a limitation.
- **Injection through rendered content.** Raw HTML renders as inert source text apart from a tiny allowlist, so anything that gets a script, an event handler, or a live element past that boundary (through Markdown, a directive, an inline widget, or a bundled plugin) is a hole worth reporting.
- **Round-trip corruption**, meaning input where `serialize(parse(source)) !== source`. Byte honesty is a core promise, and silently rewriting a file counts as a security problem when the file is somebody's notes.

Out of scope: what the embedding app does with the string after `getSource()`, and dependency advisories with no path through aragonite's own API (report those upstream, though a heads-up here is always welcome).
