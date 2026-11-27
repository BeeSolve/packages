import { asResponseStreamHandler } from "@beesolve/lambda-fetch-api";
import { keptActiveStreaming } from "@beesolve/lambda-keep-active/runtime";
import type { APIGatewayProxyEventV2, StreamifyHandler } from "aws-lambda";

import { parseConfig } from "./config";
import { createFetchHandler } from "./fetchHandler";
import { createBunIntermediateStore } from "./intermediates";
import { createBunImageSource } from "./source";

Bun.Image.backend = "bun";

const config = parseConfig(process.env);

export const handler: StreamifyHandler<APIGatewayProxyEventV2, void> = keptActiveStreaming(
  asResponseStreamHandler(
    createFetchHandler({
      config,
      source: createBunImageSource({ bucket: config.sourceBucket }),
      store: createBunIntermediateStore({ bucket: config.intermediateBucket }),
    }),
  ),
);
