import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  APIGatewayProxyResult,
  APIGatewayProxyResultV2,
  Context,
  StreamifyHandler,
} from "aws-lambda";
import { awsRequest, awsResponseBody, awsResponseHeaders } from "./src/util";

export * from "./src/runtime";
export * from "./src/util";

type Fetch = (request: Request) => Promise<Response>;

export function asHttpV1Handler(fetch: Fetch) {
  return async function handler(
    event: APIGatewayProxyEvent,
    context: Context,
  ): Promise<APIGatewayProxyResult> {
    const request = awsRequest(event, context);
    const response = await fetch(request);

    return {
      statusCode: response.status,
      ...awsResponseHeaders(response, "v1"),
      ...(await awsResponseBody(response)),
    };
  };
}

export function asHttpV2Handler(fetch: Fetch) {
  return async function handler(
    event: APIGatewayProxyEventV2,
    context: Context,
  ): Promise<APIGatewayProxyResultV2> {
    const request = awsRequest(event, context);
    const response = await fetch(request);

    return {
      statusCode: response.status,
      ...awsResponseHeaders(response, "v2"),
      ...(await awsResponseBody(response)),
    };
  };
}

export function asResponseStreamHandler(
  fetch: Fetch,
): StreamifyHandler<APIGatewayProxyEventV2, void> {
  return awslambda.streamifyResponse(
    async (event: APIGatewayProxyEventV2, responseStream, context) => {
      const request = awsRequest(event, context);

      const response = await fetch(request);

      const httpResponseMetadata = {
        statusCode: response.status,
        ...awsResponseHeaders(response, "v2"),
      };

      if (!httpResponseMetadata.headers!["transfer-encoding"]) {
        httpResponseMetadata.headers!["transfer-encoding"] = "chunked";
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
      responseStream = awslambda.HttpResponseStream.from(
        responseStream,
        httpResponseMetadata,
      );

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
