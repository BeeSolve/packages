import { AnalyticsDashboard } from "@beesolve/analytics-dashboard/cdk";
import { requiredRecordFields } from "@beesolve/analytics-processor";
import { AnalyticsProcessor } from "@beesolve/analytics-processor/cdk";
import { AuthGateway } from "@beesolve/auth-service/cdk";
import { CloudFrontAccessLoggingSettings } from "@beesolve/cdk-constructs";
import { RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import type { Construct } from "constructs";

export class AnalyticsStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const account = props.env?.account;
    const emailAddress = process.env.SAMPLES_EMAIL_ADDRESS;
    const frontendUri = process.env.SAMPLES_ANALYTICS_DASHBOARD_FRONTEND_URI;

    if (account == null) {
      throw new Error("env.account must be set on the stack (AWS_ACCOUNT, see mise.toml)");
    }

    if (emailAddress == null) {
      throw new Error("SAMPLES_EMAIL_ADDRESS must be set (see mise.toml)");
    }

    if (frontendUri == null) {
      throw new Error("SAMPLES_ANALYTICS_DASHBOARD_FRONTEND_URI must be set (see mise.toml)");
    }

    const logging = new CloudFrontAccessLoggingSettings(this, "Logging", {
      athena: { account, recordFields: requiredRecordFields },
    });

    const distribution = new Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: new HttpOrigin("example.com"),
      },
      ...logging.cloudFrontLoggingSettings,
    });

    logging.enableV2Logging({
      distributionArn: `arn:aws:cloudfront::${account}:distribution/${distribution.distributionId}`,
    });

    const glueDatabaseName = logging.glueDatabaseName;
    const glueTableName = logging.glueTableName;
    const workgroupName = logging.workgroupName;

    if (glueDatabaseName == null || glueTableName == null || workgroupName == null) {
      throw new Error("Athena must be configured on CloudFrontAccessLoggingSettings");
    }

    const processor = new AnalyticsProcessor(this, "Processor", {
      athenaDatabase: glueDatabaseName,
      athenaV2Table: glueTableName,
      athenaWorkgroup: workgroupName,
      logBucketArn: logging.logBucket.bucketArn,
      athenaResultsBucketArn: logging.athenaResultsBucket?.bucketArn,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const auth = new AuthGateway(this, "Auth", {
      stage: "dev",
      frontendUri,
      allowSignUp: false,
      authorizerCache: "disabled",
    });

    new AnalyticsDashboard(this, "Dashboard", {
      auth,
      processor,
      emailSender: {
        name: "Analytics Dashboard",
        emailAddress: `no-reply@${emailAddress.split("@")[1]}`,
      },
    });
  }
}
