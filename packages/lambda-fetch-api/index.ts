import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  APIGatewayProxyResult,
  APIGatewayProxyStructuredResultV2,
  APIGatewayProxyWithLambdaAuthorizerEvent,
  APIGatewayProxyEventV2WithLambdaAuthorizer,
  Context as LambdaContext,
  StreamifyHandler,
} from "aws-lambda";

import { runWithAwsContext } from "./src/store";
import { MalformedRequestError, awsRequest, awsResponseBody, awsResponseHeaders } from "./src/util";

export * from "./src/authorizer";
export * from "./src/runtime";
export * from "./src/store";
export * from "./src/util";

type Fetch = (request: Request) => Promise<Response>;
type Context = Omit<LambdaContext, "done" | "succeed" | "fail">;

function tryAwsRequest(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): Request | undefined {
  try {
    return awsRequest(event);
  } catch (error) {
    if (error instanceof MalformedRequestError) {
      return undefined;
    }
    throw error;
  }
}

function badRequestResult(version: "v1" | "v2"): APIGatewayProxyResult {
  return {
    statusCode: 400,
    headers: { "content-type": "text/plain" },
    body: "Bad Request",
    ...(version === "v1" ? { multiValueHeaders: {} } : {}),
  };
}

async function toProxyResult(props: {
  request: Request;
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2;
  context: Context;
  fetch: Fetch;
  version: "v1" | "v2";
}): Promise<APIGatewayProxyResult> {
  const { request, event, context, fetch, version } = props;
  const response = await runWithAwsContext(event, context, () => fetch(request));

  return {
    statusCode: response.status,
    ...awsResponseHeaders(response, version),
    ...(await awsResponseBody(response)),
  };
}

export function asHttpV1Handler(fetch: Fetch) {
  return async function handler(
    event: APIGatewayProxyEvent,
    context: Context,
  ): Promise<APIGatewayProxyResult> {
    const request = tryAwsRequest(event);
    if (request == null) {
      return badRequestResult("v1");
    }
    return toProxyResult({ request, event, context, fetch, version: "v1" });
  };
}

export function asHttpV2Handler(fetch: Fetch) {
  return async function handler(
    event: APIGatewayProxyEventV2,
    context: Context,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const request = tryAwsRequest(event);
    if (request == null) {
      return badRequestResult("v2");
    }
    return toProxyResult({ request, event, context, fetch, version: "v2" });
  };
}

export function asLambdaAuthorizedHttpV2Handler<TAuth = unknown>(fetch: Fetch) {
  return async function handler(
    event: APIGatewayProxyEventV2WithLambdaAuthorizer<TAuth>,
    context: Context,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const request = tryAwsRequest(event);
    if (request == null) {
      return badRequestResult("v2");
    }
    return toProxyResult({ request, event, context, fetch, version: "v2" });
  };
}

export function asCustomAuthorizedHttpV1Handler<TAuth = unknown>(fetch: Fetch) {
  return async function handler(
    event: APIGatewayProxyWithLambdaAuthorizerEvent<TAuth>,
    context: Context,
  ): Promise<APIGatewayProxyResult> {
    const request = tryAwsRequest(event);
    if (request == null) {
      return badRequestResult("v1");
    }
    return toProxyResult({ request, event, context, fetch, version: "v1" });
  };
}

export function asResponseStreamHandler(
  fetch: Fetch,
): StreamifyHandler<APIGatewayProxyEventV2, void> {
  return awslambda.streamifyResponse(
    async (event: APIGatewayProxyEventV2, responseStream, context) => {
      const request = awsRequest(event);

      const response = await runWithAwsContext(event, context, () => fetch(request));

      const httpResponseMetadata = {
        statusCode: response.status,
        ...awsResponseHeaders(response, "v2"),
      };

      if (httpResponseMetadata.headers?.["transfer-encoding"] == null) {
        httpResponseMetadata.headers["transfer-encoding"] = "chunked";
      }

      const body =
        response.body ??
        new ReadableStream<string>({
          start(controller) {
            controller.enqueue("");
            controller.close();
          },
        });

      // Assign to the responseStream parameter to prevent accidental reuse of the non-wrapped stream.
      // @see https://docs.aws.amazon.com/lambda/latest/dg/response-streaming-tutorial.html
      responseStream = awslambda.HttpResponseStream.from(responseStream, httpResponseMetadata);

      // Call write on the stream to trigger metadata to be sent
      // https://github.com/aws/aws-lambda-nodejs-runtime-interface-client/blob/2ce88619fd176a5823bc5f38c5484d1cbdf95717/src/HttpResponseStream.js#L22
      // @see https://github.com/Data-Only-Greater/sveltekit-adapter-aws-base/blob/b61777077ac4d306ccf96727a94c252dd37ef500/lambda/serverless_streaming.js#L74
      responseStream.write("");

      const reader = body.getReader();
      await streamToNodeStream(reader, responseStream);
    },
  );
}

async function streamToNodeStream(
  reader: ReadableStreamDefaultReader,
  writer: NodeJS.WritableStream,
) {
  let readResult = await reader.read();
  while (!readResult.done) {
    writer.write(readResult.value);
    readResult = await reader.read();
  }
  writer.end();
}
