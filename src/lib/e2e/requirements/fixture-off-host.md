# Harness: no request leaves for another host

An e2e run needs no network beyond the app server it built. The shared fixture blocks every request
for another origin, in every page of the test's browser context, and fails the spec at teardown
with each blocked request's resource type and URL and the spec's path. A spec that needs a page or
image from a test-only host (`https://e2e-deferred.test/`, `https://e2e-link.test/`) answers it
with its own route, which runs before the fixture's. The harness's own images are files in
`static/test-fixtures/`.

## Error cases

- an image from another host: blocked, and the spec fails at teardown
- a `fetch` to another host: blocked, and the spec fails at teardown
- a new tab opened at another host: its page is blocked, and the spec fails at teardown

## Happy paths

- a request for a test-only host the spec answers with its own route passes

## Miss-analysis

- The harness document and three specs loaded photos from picsum.photos and two link specs opened
  example.com, so a run without network failed: nothing watched where a page's requests went, and
  every machine that ran the suite was online.
