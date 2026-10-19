---
"@beesolve/cdk-constructs": minor
---

`StaticWebsite` now serves real 404 error pages for multi-page applications.

The `mode` prop changed from a string union to a discriminated union:

```ts
// Before
mode: "singlePageApplication"
mode: "multiPageApplication"

// After
mode: { type: "singlePageApplication" }
mode: { type: "multiPageApplication" } // defaults to /404.html with a 404 status
mode: { type: "multiPageApplication", notFoundPath: "/not-found.html" }
mode: { type: "multiPageApplication", customErrorPage: false } // pass S3's native 404 through
```

Previously `mode` was accepted but ignored, and every 404 was rewritten to
`/index.html` with status `200`. That SPA behavior is now applied only for
`singlePageApplication`. For `multiPageApplication` CloudFront returns a real
`404` status (serving `/404.html` by default) so missing-page traffic can be
filtered in analytics.

This is a breaking change to the `mode` prop shape. As a `0.x` package this is
released as a minor bump.
