# Harness: a navigation leaves a page that finished loading

Every e2e navigation (`gotoReady`, `reloadReady`, `gotoUnhydrated` in `src/lib/e2e/goto-ready.ts`)
waits for the page it leaves to finish loading, its images included, before it navigates. A load
cut off mid-flight makes Firefox report a truncated image as a page error, and can give the next
navigation an id Playwright doesn't expect, so `page.goto` fails as "interrupted by another
navigation" to the very URL it asked for.

## Happy paths

- `gotoReady` to another query, with the first page's images still loading: the next page is
  requested only after those images are answered
- `reloadReady` with the page's images still loading: same
- `gotoUnhydrated` with the page's images still loading: same, and the held scripts are only the
  new page's

## Error cases

- the page being left never finishes loading: the navigation fails within the readiness budget,
  naming that page and each image still loading by its URL

## Miss-analysis

- A second navigation in CI's Firefox failed as interrupted, or on a truncated image: the readiness
  contract covered arriving at a page only, and no row navigated while the page it left was still
  loading, though the harness's showcase images are still downloading when most specs start.
