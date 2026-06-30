import { fileURLToPath } from "node:url";

import { Nodejs24Function } from "@beesolve/cdk-constructs";
import { Duration, Tags } from "aws-cdk-lib";
import { Rule, RuleTargetInput, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import type { LogGroupProps } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

const distDir = `${fileURLToPath(new URL(".", import.meta.url))}`;

export interface LambdaKeepActiveProps {
  /**
   * If disabled no logs are logged to CloudWatch
   *
   * @default true
   */
  readonly enableLogs?: boolean;
  /**
   * Adjusts logging for SQS handler.
   *
   * @default
   *
   * {
   *   removalPolicy: RemovalPolicy.DESTROY,
   *   retention: RetentionDays.TWO_WEEKS
   * }
   */
  readonly logGroupProps?: LogGroupProps;
}

export class LambdaKeepActive extends Construct {
  constructor(scope: Construct, id: string, props: LambdaKeepActiveProps = {}) {
    super(scope, id);

    const handler = new Nodejs24Function(this, "LambdaKeepActive", {
      description: "LambdaKeepActive handler",
      entry: `${distDir}handler.zip`,
      handler: "handler.handler",
      memorySize: 128,
      timeout: Duration.minutes(5),
      environment: {
        NODE_ENV: "production",
        ENABLE_LOGS: String(props.enableLogs ?? true),
      },
      logGroupProps: props.logGroupProps,
    });

    new Rule(this, "KeepActive", {
      schedule: Schedule.rate(Duration.days(3)),
      targets: [
        new LambdaFunction(handler, {
          event: RuleTargetInput.fromObject({
            action: "lambdaKeepActive",
          }),
        }),
      ],
    });

    handler.addToRolePolicy(
      new PolicyStatement({
        actions: ["lambda:InvokeFunction", "tag:GetResources"],
        resources: ["*"],
        effect: Effect.ALLOW,
      }),
    );
  }

  readonly keepActive = (lambda: IFunction): void => {
    Tags.of(lambda).add("keepActive", "true");
  };
}
