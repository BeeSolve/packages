import { describe, expect, mock, test } from "bun:test";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  type DeleteCommand,
  type DynamoDBDocumentClient,
  GetCommand,
  type PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  ActionTokens,
  ExpiredTokenError,
  MalformedTokenError,
  TokenAlreadyUsedUpError,
  TokenDoesNotExistError,
  TokenInvalidError,
  UnexpectedError,
} from "../model.ts";

function makeRawToken(overrides: Record<string, unknown> = {}) {
  return {
    owner: "user-1",
    action: "verify-email",
    value: "tok-abc",
    remainingUses: 5,
    createdAt: new Date().toISOString(),
    expiresAt: Math.round((Date.now() + 60_000) / 1000),
    ...overrides,
  };
}

function makeClient(send: (command: unknown) => Promise<unknown>) {
  return new ActionTokens({
    dynamo: { send } as unknown as Pick<DynamoDBDocumentClient, "send">,
    tableName: "tokens",
    valueIndexName: "value-index",
  });
}

describe("ActionTokens.createNew", () => {
  test("returns a parsed token with correct field types", async () => {
    const send = mock(async (_command: unknown) => ({}));
    const client = makeClient(send);
    const expiresAt = new Date(Date.now() + 60_000);

    const token = await client.createNew({
      owner: "user-1",
      action: "verify-email",
      value: "tok-abc",
      remainingUses: 3,
      expiresAt,
      data: undefined,
      overwrite: false,
    });

    expect(token.owner).toBe("user-1");
    expect(token.action).toBe("verify-email");
    expect(token.value).toBe("tok-abc");
    expect(token.remainingUses).toBe(3);
    expect(token.expiresAt).toBeInstanceOf(Date);
    expect(token.createdAt).toBeInstanceOf(Date);
  });

  test("without overwrite: PutCommand includes attribute_not_exists condition", async () => {
    const send = mock(async (_command: unknown) => ({}));
    const client = makeClient(send);

    await client.createNew({
      owner: "user-1",
      action: "verify-email",
      value: "tok-abc",
      remainingUses: 1,
      expiresAt: new Date(Date.now() + 60_000),
      data: undefined,
      overwrite: false,
    });

    const command = send.mock.calls[0]?.[0] as unknown as PutCommand;
    expect(command.input.ConditionExpression).toContain("attribute_not_exists");
  });

  test("with overwrite: PutCommand has no ConditionExpression", async () => {
    const send = mock(async (_command: unknown) => ({}));
    const client = makeClient(send);

    await client.createNew({
      owner: "user-1",
      action: "verify-email",
      value: "tok-abc",
      remainingUses: 1,
      expiresAt: new Date(Date.now() + 60_000),
      data: undefined,
      overwrite: true,
    });

    const command = send.mock.calls[0]?.[0] as unknown as PutCommand;
    expect(command.input.ConditionExpression).toBeUndefined();
  });

  test("passes data through to the DynamoDB item", async () => {
    const send = mock(async (_command: unknown) => ({}));
    const client = makeClient(send);
    const data = { userId: "u-99", role: "admin" };

    await client.createNew({
      owner: "user-1",
      action: "verify-email",
      value: "tok-abc",
      remainingUses: 1,
      expiresAt: new Date(Date.now() + 60_000),
      data,
      overwrite: false,
    });

    const command = send.mock.calls[0]?.[0] as unknown as PutCommand;
    expect(command.input.Item?.data).toEqual(data);
  });

  test("stores expiresAt as Unix seconds (number), not a Date", async () => {
    const send = mock(async (_command: unknown) => ({}));
    const client = makeClient(send);
    const expiresAt = new Date(Date.now() + 60_000);

    await client.createNew({
      owner: "user-1",
      action: "verify-email",
      value: "tok-abc",
      remainingUses: 1,
      expiresAt,
      data: undefined,
      overwrite: false,
    });

    const command = send.mock.calls[0]?.[0] as unknown as PutCommand;
    expect(typeof command.input.Item?.expiresAt).toBe("number");
    expect(command.input.Item?.expiresAt).toBe(
      Math.round(expiresAt.getTime() / 1000),
    );
  });
});

describe("ActionTokens.use — owner provided (GetCommand path)", () => {
  test("happy path: calls GetCommand then UpdateCommand and returns the updated token", async () => {
    const raw = makeRawToken();
    const send = mock(async (command: unknown) => {
      if (command instanceof GetCommand) return { Item: raw };
      if (command instanceof UpdateCommand) return { Attributes: raw };
      return {};
    });
    const client = makeClient(send);

    const token = await client.use({
      owner: "user-1",
      action: "verify-email",
      value: "tok-abc",
      drainWhenValid: false,
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(token.owner).toBe(raw.owner);
    expect(token.expiresAt).toBeInstanceOf(Date);
  });

  test("drainWhenValid true: UpdateCommand sets newRemainingUses to 0", async () => {
    const raw = makeRawToken({ remainingUses: 5 });
    const send = mock(async (command: unknown) => {
      if (command instanceof GetCommand) return { Item: raw };
      if (command instanceof UpdateCommand) return { Attributes: raw };
      return {};
    });
    const client = makeClient(send);

    await client.use({
      owner: "user-1",
      action: "verify-email",
      value: "tok-abc",
      drainWhenValid: true,
    });

    const updateCommand = send.mock.calls.find(
      ([c]) => c instanceof UpdateCommand,
    )?.[0] as unknown as UpdateCommand;
    expect(
      updateCommand.input.ExpressionAttributeValues?.[":newRemainingUses"],
    ).toBe(0);
  });

  test("drainWhenValid false: UpdateCommand decrements remainingUses by 1", async () => {
    const raw = makeRawToken({ remainingUses: 5 });
    const send = mock(async (command: unknown) => {
      if (command instanceof GetCommand) return { Item: raw };
      if (command instanceof UpdateCommand) return { Attributes: raw };
      return {};
    });
    const client = makeClient(send);

    await client.use({
      owner: "user-1",
      action: "verify-email",
      value: "tok-abc",
      drainWhenValid: false,
    });

    const updateCommand = send.mock.calls.find(
      ([c]) => c instanceof UpdateCommand,
    )?.[0] as unknown as UpdateCommand;
    expect(
      updateCommand.input.ExpressionAttributeValues?.[":newRemainingUses"],
    ).toBe(4);
  });

  test("token not found: throws TokenDoesNotExistError", async () => {
    const send = mock(async (_command: unknown) => ({}));
    const client = makeClient(send);

    expect(
      client.use({
        owner: "user-1",
        action: "verify-email",
        value: "tok-abc",
        drainWhenValid: false,
      }),
    ).rejects.toBeInstanceOf(TokenDoesNotExistError);
  });

  test("token expired: throws ExpiredTokenError", async () => {
    const raw = makeRawToken({
      expiresAt: Math.round((Date.now() - 60_000) / 1000),
    });
    const send = mock(async () => ({ Item: raw }));
    const client = makeClient(send);

    expect(
      client.use({
        owner: "user-1",
        action: "verify-email",
        value: "tok-abc",
        drainWhenValid: false,
      }),
    ).rejects.toBeInstanceOf(ExpiredTokenError);
  });

  test("uses exhausted: throws TokenAlreadyUsedUpError", async () => {
    const raw = makeRawToken({ remainingUses: 0 });
    const send = mock(async () => ({ Item: raw }));
    const client = makeClient(send);

    expect(
      client.use({
        owner: "user-1",
        action: "verify-email",
        value: "tok-abc",
        drainWhenValid: false,
      }),
    ).rejects.toBeInstanceOf(TokenAlreadyUsedUpError);
  });

  test("wrong value: throws TokenInvalidError after UpdateCommand fires", async () => {
    const raw = makeRawToken({ value: "correct-value" });
    const send = mock(async (command: unknown) => {
      if (command instanceof GetCommand) return { Item: raw };
      if (command instanceof UpdateCommand) return { Attributes: raw };
      return {};
    });
    const client = makeClient(send);

    await expect(
      client.use({
        owner: "user-1",
        action: "verify-email",
        value: "wrong-value",
        drainWhenValid: false,
      }),
    ).rejects.toBeInstanceOf(TokenInvalidError);

    expect(send).toHaveBeenCalledTimes(2);
  });

  test("concurrent modification: UpdateCommand ConditionalCheckFailedException throws UnexpectedError", async () => {
    const raw = makeRawToken();
    const send = mock(async (command: unknown) => {
      if (command instanceof GetCommand) return { Item: raw };
      if (command instanceof UpdateCommand)
        throw new ConditionalCheckFailedException({
          message: "conflict",
          $metadata: {},
        });
      return {};
    });
    const client = makeClient(send);

    await expect(
      client.use({
        owner: "user-1",
        action: "verify-email",
        value: "tok-abc",
        drainWhenValid: false,
      }),
    ).rejects.toBeInstanceOf(UnexpectedError);
  });

  test("malformed UpdateCommand response: throws MalformedTokenError", async () => {
    const raw = makeRawToken();
    const send = mock(async (command: unknown) => {
      if (command instanceof GetCommand) return { Item: raw };
      if (command instanceof UpdateCommand) return { Attributes: undefined };
      return {};
    });
    const client = makeClient(send);

    expect(
      client.use({
        owner: "user-1",
        action: "verify-email",
        value: "tok-abc",
        drainWhenValid: false,
      }),
    ).rejects.toBeInstanceOf(MalformedTokenError);
  });
});

describe("ActionTokens.use — owner undefined (QueryCommand path)", () => {
  test("happy path: calls QueryCommand then UpdateCommand and returns the updated token", async () => {
    const raw = makeRawToken();
    const send = mock(async (command: unknown) => {
      if (command instanceof QueryCommand) return { Items: [raw] };
      if (command instanceof UpdateCommand) return { Attributes: raw };
      return {};
    });
    const client = makeClient(send);

    const token = await client.use({
      owner: undefined,
      action: "verify-email",
      value: "tok-abc",
      drainWhenValid: false,
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(token.value).toBe(raw.value);
  });

  test("token not found (empty Items): throws TokenDoesNotExistError", async () => {
    const send = mock(async () => ({ Items: [] }));
    const client = makeClient(send);

    expect(
      client.use({
        owner: undefined,
        action: "verify-email",
        value: "tok-abc",
        drainWhenValid: false,
      }),
    ).rejects.toBeInstanceOf(TokenDoesNotExistError);
  });
});

describe("ActionTokens.drain", () => {
  test("calls DeleteCommand with correct Key", async () => {
    const send = mock(async (_command: unknown) => ({}));
    const client = makeClient(send);

    await client.drain({ owner: "user-1", action: "verify-email" });

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0]?.[0] as unknown as DeleteCommand;
    expect(command.input.Key).toEqual({
      owner: "user-1",
      action: "verify-email",
    });
  });

  test("returns undefined", async () => {
    const send = mock(async (_command: unknown) => ({}));
    const client = makeClient(send);

    const result = await client.drain({
      owner: "user-1",
      action: "verify-email",
    });

    expect(result).toBeUndefined();
  });
});
