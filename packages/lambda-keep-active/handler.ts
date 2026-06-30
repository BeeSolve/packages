import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import {
  GetResourcesCommand,
  ResourceGroupsTaggingAPIClient,
} from "@aws-sdk/client-resource-groups-tagging-api";

import { keepActivePing } from "./shared";

const lambdaClient = new LambdaClient();
const taggingClient = new ResourceGroupsTaggingAPIClient();
const enableLogs = process.env.ENABLE_LOGS === "true";

export const handler = async (event: { action: "lambdaKeepActive" }) => {
  const { action } = event;

  if (action == null) return;
  if (action !== "lambdaKeepActive") return;

  let nextToken: string | undefined;
  do {
    const { ResourceTagMappingList = [], PaginationToken } = await taggingClient.send(
      new GetResourcesCommand({
        ResourceTypeFilters: ["lambda:function"],
        ResourcesPerPage: 25,
        TagFilters: [{ Key: "keepActive", Values: ["true"] }],
        PaginationToken: nextToken,
      }),
    );

    nextToken = PaginationToken;

    await Promise.all(
      ResourceTagMappingList.map(async (resource) => {
        await lambdaClient.send(
          new InvokeCommand({
            FunctionName: resource.ResourceARN,
            InvocationType: "Event",
            Payload: JSON.stringify({ [keepActivePing]: true }),
          }),
        );

        if (enableLogs) {
          console.info(`Invoked ${resource.ResourceARN}`);
        }
      }),
    );
  } while (nextToken != null && nextToken !== "");
};
