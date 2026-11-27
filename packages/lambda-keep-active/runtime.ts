import { keepActivePing } from "./shared";

interface KeptActiveOptions {
  /**
   * If disabled no logs are logged to CloudWatch
   *
   * @default true
   */
  readonly enableLogs?: boolean;
}

// oxlint-disable-next-line typescript/no-explicit-any
export function keptActive<Event = any, Context = any, Response = any>(
  handler: (event: Event, context: Context) => Promise<Response>,
  options?: KeptActiveOptions,
) {
  return (event: Event, context: Context): void | Promise<Response> => {
    if (isKeepActivePing(event)) {
      logPing({ event, options });
      return;
    }

    return handler(event, context);
  };
}

/**
 * Like `keptActive`, for streaming handlers with the signature
 * `(event, responseStream, context)`, for example the result of `asResponseStreamHandler` or
 * `awslambda.streamifyResponse`. A ping returns without calling the handler and without
 * writing to the stream. Own properties of the wrapped handler, including the streaming marker
 * symbol the Lambda runtime uses to detect streaming handlers, are copied to the returned
 * function, so it is still invoked as a streaming handler.
 */
export function keptActiveStreaming<Event, ResponseStream, Context>(
  handler: (event: Event, responseStream: ResponseStream, context: Context) => Promise<void> | void,
  options?: KeptActiveOptions,
): (event: Event, responseStream: ResponseStream, context: Context) => Promise<void> | void {
  const wrapper = (
    event: Event,
    responseStream: ResponseStream,
    context: Context,
  ): Promise<void> | void => {
    if (isKeepActivePing(event)) {
      logPing({ event, options });
      return;
    }

    return handler(event, responseStream, context);
  };
  return Object.defineProperties(wrapper, Object.getOwnPropertyDescriptors(handler));
}

function isKeepActivePing(event: unknown): boolean {
  return (
    event != null &&
    typeof event === "object" &&
    keepActivePing in event &&
    event[keepActivePing] === true
  );
}

interface LogPingProps {
  event: unknown;
  options: KeptActiveOptions | undefined;
}

function logPing(props: LogPingProps): void {
  if (props.options?.enableLogs) {
    console.info(`Keep active ping: ${JSON.stringify(props.event)}`);
  }
}

export function keptActiveFetch(
  fetch: (request: Request) => Promise<Response>,
  options?: KeptActiveOptions,
) {
  return async (request: Request): Promise<Response> => {
    if (request.url === "https://lambda/") {
      const event = await request.json();

      if (
        event != null &&
        typeof event === "object" &&
        keepActivePing in event &&
        event[keepActivePing] === true
      ) {
        if (options?.enableLogs) {
          console.info(`Keep active ping: ${JSON.stringify(event)}`);
        }
        return new Response();
      }

      return fetch(
        new Request(request.url, {
          method: request.method,
          body: JSON.stringify(event),
          headers: request.headers,
        }),
      );
    }

    return fetch(request);
  };
}
