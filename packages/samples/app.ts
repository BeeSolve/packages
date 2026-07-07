import { App } from "aws-cdk-lib";

import { EmailSimpleStack } from "./authSimpleEmail/stack.ts";

const app = new App();

new EmailSimpleStack(app, "SamplesAuthEmailSimple", {
  env: {
    account: "252955337360",
    region: "eu-central-1",
  },
});
