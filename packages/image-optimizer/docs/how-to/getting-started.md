# How to: Serve optimized images from S3 with CloudFront

> Full working example: https://github.com/BeeSolve/packages/tree/main/packages/samples/imageOptimizer

## Prerequisites

- A CDK app with `aws-cdk-lib` 2.278.0 or newer
- A stack with a concrete region where the Bun runtime is published: `eu-north-1`, `eu-central-1`, `eu-west-1`, `us-east-1` or `us-west-2`

## Steps

### 1. Install

```sh
bun add @beesolve/image-optimizer @beesolve/lambda-keep-active
```

(or `npm install @beesolve/image-optimizer @beesolve/lambda-keep-active`)

### 2. Add the distribution and the construct

`createImageOptimizerDistribution` creates a distribution that answers 404 outside the assets prefix. Pass `distributionProps` for a custom domain, certificate or price class.

```ts
import { createImageOptimizerDistribution, ImageOptimizer } from "@beesolve/image-optimizer/cdk";
import { LambdaKeepActive } from "@beesolve/lambda-keep-active";
import { CfnOutput, Stack } from "aws-cdk-lib";
import { Bucket } from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

export class ImagesStack extends Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id, { env: { region: "eu-central-1" } });

    const bucket = new Bucket(this, "Images");
    const distribution = createImageOptimizerDistribution({
      scope: this,
      id: "Distribution",
      bucket,
    });
    new ImageOptimizer(this, "ImageOptimizer", {
      bucket,
      distribution,
      keepActive: new LambdaKeepActive(this, "KeepActive"),
    });

    new CfnOutput(this, "ImagesUrl", { value: `https://${distribution.distributionDomainName}` });
  }
}
```

### 3. Upload an image under the assets prefix

The request path is the S3 key, including the prefix:

```sh
aws s3 cp cat.jpg s3://<bucket>/assets/photos/cat.jpg
```

### 4. Request resized versions

```sh
curl -H "Accept: image/webp" -o cat.webp "https://<distribution>/assets/photos/cat.jpg?w=400"
curl -o cat.jpg "https://<distribution>/assets/photos/cat.jpg?w=400&h=400&fit=max&q=60"
curl "https://<distribution>/assets/photos/cat.jpg?placeholder=1"
```

The first returns WebP, the second keeps JPEG because `Accept` does not list `image/webp`, the third returns a `data:image/png;base64,...` placeholder. Check `X-Image-Optimizer` in the response to see whether the image was `optimized`, a `placeholder`, or a `passthrough` of an unsupported format.

## Common Pitfalls

- **Opening the URL in the address bar returns JPEG.** That is a document request without `image/webp` in `Accept`. `<img>` tags get WebP. Test with `curl -H "Accept: image/webp"`.
- **404 for an existing object.** The object must be under the assets prefix (`assets/` by default), and the key is case-sensitive, also the extension.
- **400 for `crop`, `blur` or `fit=crop`.** These imgix parameters are not supported yet and are rejected instead of returning a different image.
- **Region without the Bun runtime.** Synth fails for regions where the runtime is not published.
- **Existing distribution.** Pass your own `Distribution` instead of one from `createImageOptimizerDistribution`. The construct only adds its behaviors, your default behavior keeps serving whatever it served before, and behaviors you added earlier win for overlapping path patterns.

## See Also

- [Generate URLs](./generate-urls.md)
- [README](../../README.md) - props, parameters, headers and limits
