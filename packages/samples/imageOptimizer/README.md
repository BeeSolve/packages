# imageOptimizer sample

Deploys `@beesolve/image-optimizer` with a private source bucket, the four sample photos from
`photos/` under `assets/photos/` and a few non-image files under `assets/files/`, plus
`LambdaKeepActive`.

```sh
mise exec -- bun run deploy:imageOptimizer
```

Stack outputs: the distribution URL, the source and intermediate bucket names and the function name.

## Integration tests

| File             | Purpose                                                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.ts`         | CDK app with only this stack, used by CI (`IMAGE_OPTIMIZER_STACK_NAME` sets the stack name)                                                        |
| `fixtures.ts`    | Generates the animation and transparency fixtures in `fixtures/` (`bun run fixtures:imageOptimizer`), committed so no third-party files are needed |
| `testPages.ts`   | Generates the visual test pages with `generateUrl`, deployed to `/assets/test/`                                                                    |
| `verify.ts`      | Automated checks against a deployed stack (`bun run verify:imageOptimizer <url>`)                                                                  |
| `screenshots.ts` | Full-page screenshots of every test page with `Bun.WebView` and Chrome (`bun run screenshots:imageOptimizer <url> <dir>`)                          |

Test pages: `/assets/test/index.html` links `photo-01` to `photo-04` (every mutation on each photo), `animated` (animated WebP and GIF) and `alpha` (PNG and WebP with transparency on a checkerboard). Every image shows its expected result and, below the link, the `Content-Type`, size and `X-Image-Optimizer` of the response.

`.github/workflows/image-optimizer-integration.yml` runs on pull requests that touch the image optimizer, `lambda-keep-active` or this sample, and on demand:

1. `deploy` builds the package, deploys a stack named `ImageOptimizerInteg<run id>`, runs `verify.ts`, takes screenshots, uploads them as the `image-optimizer-screenshots` artifact and writes the test page URL to the job summary.
2. `visual-review` uses the environment `image-optimizer-visual-review`. With required reviewers on that environment the run waits until a reviewer compares the pages and approves.
3. `destroy` removes the stack after the review, also when the review is rejected or an earlier step failed.

One-time setup, not done yet:

- An IAM role that GitHub Actions in `BeeSolve/packages` can assume through OIDC, allowed to assume the CDK bootstrap roles of the account (same pattern as `lambda-bun-runtime/docs/aws-oidc-setup.md`, with `repo:BeeSolve/packages:*` in the trust policy). Store its ARN as the repository secret `AWS_INTEG_ROLE_ARN`.
- The environment `image-optimizer-visual-review` with required reviewers (`gh api -X PUT repos/BeeSolve/packages/environments/image-optimizer-visual-review` with a `reviewers` list).
- Optional: make `visual-review` a required status check on `main`.

## Files

| Key                                                  | Purpose                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `assets/photos/01.jpeg` .. `04.jpeg`                 | Real photos, 4032x3024 to 5712x4284, `04.jpeg` is a portrait stored with EXIF orientation 6 |
| `assets/files/mislabelled.jpg`                       | A GIF under a `.jpg` key, reaches the function and is passed through                        |
| `assets/files/pixel.gif`, `logo.svg`, `document.pdf` | Served from the bucket by the `/assets/*` behavior                                          |

## Verification

Run on 2026-11-26 against `SamplesImageOptimizer` in `eu-central-1`,
`@beesolve/lambda-bun-runtime` 4.10405.1, 2048 MB arm64.

| #   | Request                                                                         | Expected                                                                                                       | Result                             |
| --- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1   | `01.jpeg?w=300`, `Accept: image/webp`                                           | WebP 300x225, `X-Image-Optimizer: optimized`                                                                   | pass                               |
| 2   | `01.jpeg?w=300`, `Accept: */*`                                                  | JPEG 300x225                                                                                                   | pass                               |
| 3   | `01.jpeg?w=8000&h=8000&fit=max`                                                 | never enlarges, 4032x3024                                                                                      | pass                               |
| 4   | `04.jpeg?w=300` (EXIF orientation 6)                                            | portrait 300x400                                                                                               | pass                               |
| 5   | `?h=200&w=100`, then `?w=100&h=200`, then `?W=0100&H=200&utm_source=x&fit=clip` | first miss, then `Hit from cloudfront` twice                                                                   | pass                               |
| 6   | Chrome `Accept` then Firefox `Accept`                                           | second request is a cache hit                                                                                  | pass                               |
| 7   | `?w=100&w=150`                                                                  | last value wins, 150 wide                                                                                      | pass                               |
| 8   | `?crop=top`, `?fit=crop`, `?w=abc`                                              | 400 from the CloudFront Function (`FunctionGeneratedResponse`)                                                 | pass                               |
| 9   | `?w=9000`                                                                       | 400 from the function (limit 8192)                                                                             | pass                               |
| 10  | `/assets/photos%2F..%2F01.jpeg`                                                 | 400 from the CloudFront Function                                                                               | pass                               |
| 11  | `/assets/%2e%2e/secret.jpg`                                                     | CloudFront normalizes the path to `/secret.jpg` before routing, served by the default behavior, S3 answers 403 | pass, never reaches the function   |
| 12  | missing `photos/missing.jpg`                                                    | 404 without `X-Image-Optimizer`                                                                                | pass                               |
| 13  | `files/mislabelled.jpg?w=100`                                                   | GIF bytes unchanged, `Content-Type: image/gif`, `passthrough; reason=unsupported-format; format=gif`           | pass after fixing the content type |
| 14  | `files/pixel.gif`, `logo.svg`, `document.pdf`                                   | served from S3, no `X-Image-Optimizer`                                                                         | pass                               |
| 15  | `?w=200&fm=png`, `?fm=jpg&q=30` vs `q=90`                                       | PNG; JPEG 22 KB vs 68 KB                                                                                       | pass                               |
| 16  | `?placeholder=1`                                                                | `text/plain` data URL, 1.3 KB, `X-Image-Optimizer: placeholder`                                                | pass                               |
| 17  | `03.jpeg?rot=90&w=200`, `?w=300&h=300&fit=scale`, `?w=150&dpr=2`                | 200x267, 300x300, 300x225                                                                                      | pass                               |
| 18  | `w=250`, `260`, `270`, `480` on `02.jpeg` (5712x4284)                           | all served from the one 500 px intermediate, no new objects                                                    | pass, 160 to 200 ms per miss       |
| 19  | `w=600`, `w=1600`                                                               | one 1000 px and one 2000 px intermediate                                                                       | pass, 0.5 s and 1.2 s on a miss    |
| 20  | cache hit                                                                       |                                                                                                                | 68 ms                              |
| 21  | `w=1%301`                                                                       | decoded to `w=101` at the edge                                                                                 | pass                               |
| 22  | HEAD                                                                            | headers without body                                                                                           | pass                               |
| 23  | key `photos/ľšč mačka #1.jpeg`, percent-encoded URL                             | resized                                                                                                        | pass                               |
| 24  | keep-active ping through `aws lambda invoke`                                    | status 200, no function error, empty body, tag `keepActive=true`                                               | pass                               |
| 25  | Function URL called directly                                                    | 403 (OAC with `AWS_IAM`)                                                                                       | pass                               |

Function metrics over the 29 invocations of the run: no errors in the log group, p50 82 ms,
max 1.8 s (full-size re-encode of a 12 MP photo), max memory 155 MB, cold start (init) 98 to 106 ms.
Streaming with status code and headers (`InvokeMode.RESPONSE_STREAM`, OAC) works on the Bun runtime
4.10405.1.

Issues found and fixed during the run:

- The default behavior of the created distribution served the whole bucket. It now answers 404 from a CloudFront Function (`createImageOptimizerDistribution`), only `/{assetsPathPrefix}/*` is reachable.

- The function looked up the key without the assets prefix, while the S3 behavior serves the full key. The S3 key is now `{assetsPathPrefix}/{path}` for both.
- Passthrough used the stored content type (`image/jpeg` for the mislabelled GIF). It now uses the sniffed format.

## Format negotiation

WebP is served only when `Accept` lists `image/webp`. Browsers send that for `<img>`, CSS and
`<picture>` requests, but not when an image URL is opened directly in the address bar: that is a
document navigation (`Sec-Fetch-Dest: document`) with the HTML `Accept` header, so the original
format (JPEG) is returned. Use `<img>` or `curl -H "Accept: image/webp"` to check WebP output.

## Animations and transparency

Run on 2026-11-26 with the generated fixtures and real third-party files uploaded by hand (not committed, licenses unknown or attribution-only): `animation-alpha-test.gif` and `.webp` from canbari.com, `1.webp` from the Google WebP gallery, `Rotating_earth_(large).gif` from Wikimedia Commons (CC BY-SA 3.0), `mslug5.webp` from github.com/inigomonyota/webptestimages, `1.webp` from colinbendell.github.io (9.5 MB, 325 frames), `1.png` and `1_webp_a.webp` from the Google WebP gallery.

| Source                           | Request                                  | Result                                                                                                                                                                                           |
| -------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Animated WebP (12 to 100 frames) | any (`w`, `fm=jpg`, `fm=png`, `fm=webp`) | returned unchanged and still animated, `passthrough; reason=unsupported-format; format=animated-webp`. Before the fix: 422, because `Bun.Image` reads the header but cannot decode animated WebP |
| Animated GIF                     | any                                      | served from the bucket unchanged, parameters ignored (`.gif` is not routed to the function)                                                                                                      |
| PNG or WebP with transparency    | resize, `fm=webp`, `fm=png`, rotate      | transparency kept, full and partial                                                                                                                                                              |
| PNG or WebP with transparency    | `fm=jpg`                                 | JPEG has no alpha, the transparent area shows the colour stored under it (black for most files)                                                                                                  |

Resizing or converting animations needs a native module, see "Animated GIF and WebP" in the plan's future work.

Clean up with `bun run cdk destroy SamplesImageOptimizer`.

## Scripts

| Script                            | Purpose                                                                                                                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/compareIntermediates.ts` | Local visual comparison of direct resizes and resizes through intermediates (`bun imageOptimizer/scripts/compareIntermediates.ts`), the evidence behind the package's ADR-003 |
| `scripts/stripJpegMetadata.ts`    | Removes EXIF and other metadata segments from JPEGs without re-encoding, used for the photos in `photos/`                                                                     |
