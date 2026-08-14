import { AuthGateway } from "@beesolve/auth-service/cdk";
import { DmarcConsumer } from "@beesolve/dmarc-consumer/cdk";
import { DmarcDashboard } from "@beesolve/dmarc-dashboard/cdk";
import { DmarcReports } from "@beesolve/dmarc-reports/cdk";
import { RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import type { Construct } from "constructs";

export class DmarcReportsStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const recipient = process.env.SAMPLES_DMARC_RECIPIENT;
    const emailAddress = process.env.SAMPLES_EMAIL_ADDRESS;
    const frontendUri = process.env.SAMPLES_DMARC_DASHBOARD_FRONTEND_URI;

    if (recipient == null) {
      throw new Error("SAMPLES_DMARC_RECIPIENT must be set (see mise.toml)");
    }

    if (emailAddress == null) {
      throw new Error("SAMPLES_EMAIL_ADDRESS must be set (see mise.toml)");
    }

    if (frontendUri == null) {
      throw new Error("SAMPLES_DMARC_DASHBOARD_FRONTEND_URI must be set (see mise.toml)");
    }

    new DmarcReports(this, "DmarcReports", { recipient });

    const consumer = new DmarcConsumer(this, "DmarcConsumer", {
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const auth = new AuthGateway(this, "Auth", {
      stage: "dev",
      frontendUri,
      allowSignUp: false,
      authorizerCache: "disabled",
    });

    new DmarcDashboard(this, "Dashboard", {
      auth,
      consumer,
      emailSender: {
        name: "DMARC Dashboard",
        emailAddress: `no-reply@${recipient.split("@")[1]}`,
      },
    });
  }
}
