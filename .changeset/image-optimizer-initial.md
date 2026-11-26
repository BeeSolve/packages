---
"@beesolve/image-optimizer": minor
---

First release. `ImageOptimizer` CDK construct and `createImageOptimizerDistribution` (`@beesolve/image-optimizer/cdk`). The construct resizes and re-encodes JPEG, PNG and WebP images from an S3 bucket behind CloudFront with a subset of the imgix Rendering API (`w`, `h`, `dpr`, `fit`, `q`, `fm`, `rot`, `flip`, `placeholder`), WebP negotiation, a canonicalizing CloudFront Function, size-bucket intermediates and the `X-Image-Optimizer` outcome header. Includes `generateUrl` with typed mutations (`@beesolve/image-optimizer`).
