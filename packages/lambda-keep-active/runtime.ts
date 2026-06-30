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
    if (
      event != null &&
      typeof event === "object" &&
      keepActivePing in event &&
      event[keepActivePing] === true
    ) {
      if (options?.enableLogs) {
        console.info(`Keep active ping: ${JSON.stringify(event)}`);
      }
      return;
    }

    return handler(event, context);
  };
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
