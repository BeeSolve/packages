import { join } from "node:path";

import { createImageOptimizerDistribution, ImageOptimizer } from "@beesolve/image-optimizer/cdk";
import { LambdaKeepActive } from "@beesolve/lambda-keep-active";
import { CfnOutput, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { BlockPublicAccess, Bucket } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import type { Construct } from "constructs";

import { fixturesDirectory } from "./fixtures.ts";
import { testPages, testPagesPrefix } from "./testPages.ts";

export class ImageOptimizerStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const source = new Bucket(this, "Source", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = createImageOptimizerDistribution({
      scope: this,
      id: "Distribution",
      bucket: source,
    });
    const optimizer = new ImageOptimizer(this, "ImageOptimizer", {
      bucket: source,
      distribution,
      keepActive: new LambdaKeepActive(this, "KeepActive"),
    });
    const url = `https://${distribution.distributionDomainName}`;

    const deployment = new BucketDeployment(this, "Photos", {
      destinationBucket: source,
      destinationKeyPrefix: "assets/photos",
      sources: [Source.asset(join(import.meta.dirname, "photos"))],
      distribution,
      distributionPaths: ["/assets/*"],
      memoryLimit: 1024,
    });

    new BucketDeployment(this, "Files", {
      destinationBucket: source,
      destinationKeyPrefix: "assets/files",
      sources: [Source.asset(join(import.meta.dirname, "files"))],
      distribution,
      distributionPaths: ["/assets/*"],
    }).node.addDependency(deployment);

    new BucketDeployment(this, "Fixtures", {
      destinationBucket: source,
      destinationKeyPrefix: "assets/fixtures",
      sources: [Source.asset(fixturesDirectory)],
      distribution,
      distributionPaths: ["/assets/*"],
    }).node.addDependency(deployment);

    new BucketDeployment(this, "TestPages", {
      destinationBucket: source,
      destinationKeyPrefix: testPagesPrefix,
      sources: Object.entries(testPages()).map(([name, html]) => Source.data(name, html)),
      distribution,
      distributionPaths: [`/${testPagesPrefix}/*`],
    }).node.addDependency(deployment);

    new CfnOutput(this, "ImageOptimizerUrl", { value: url });
    new CfnOutput(this, "TestPagesUrl", { value: `${url}/${testPagesPrefix}/index.html` });
    new CfnOutput(this, "SourceBucketName", { value: source.bucketName });
    new CfnOutput(this, "IntermediateBucketName", {
      value: optimizer.intermediateBucket.bucketName,
    });
    new CfnOutput(this, "FunctionName", { value: optimizer.handler.functionName });
  }
}
