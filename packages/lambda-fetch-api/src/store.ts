import { AsyncLocalStorage } from "async_hooks";

import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  Context as LambdaContext,
} from "aws-lambda";

import { isAPIGatewayProxyEvent, isAPIGatewayProxyEventV2 } from "./runtime";

type Context = Omit<LambdaContext, "done" | "succeed" | "fail">;

type Store = {
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2;
  context: Context;
};

const storage = new AsyncLocalStorage<Store>();

// oxlint-disable-next-line beesolve/prefer-props-object
export async function runWithAwsContext<T>(
  event: Store["event"],
  context: Context,
  fn: () => T | Promise<T>,
): Promise<T> {
  return storage.run({ event, context }, fn);
}

function getStore(): Store {
  const store = storage.getStore();
  if (store == null)
    throw new NotInHandlerContextError("getAws* called outside of a handler invocation.");
  return store;
}

export function getAwsEvent(): APIGatewayProxyEvent | APIGatewayProxyEventV2 {
  return getStore().event;
}

export function getAwsV2Event(): APIGatewayProxyEventV2 {
  const event = getStore().event;
  if (!isAPIGatewayProxyEventV2(event))
    throw new NotInHandlerContextError("Current event is not an API Gateway v2 event.");
  return event;
}

export function getAwsV1Event(): APIGatewayProxyEvent {
  const event = getStore().event;
  if (!isAPIGatewayProxyEvent(event))
    throw new NotInHandlerContextError("Current event is not an API Gateway v1 event.");
  return event;
}

export function getAwsContext(): Context {
  return getStore().context;
}

export class NotInHandlerContextError extends Error {}
