import { randomBytes } from "node:crypto";
import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  BatchWriteCommand,
  DeleteCommand,
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { splitArrayToChunks } from "@beesolve/helpers";
import * as v from "valibot";
import { BadRequestError, NotFoundError } from "./errors.ts";
import { printError } from "./util.ts";

const stringBoolean = v.pipe(
  v.string(),
  v.transform((value) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return undefined;
  }),
  v.optional(v.boolean()),
);

const authorizerSchema = v.object({
  id: v.string(),
  sessionId: v.string(),
  userId: v.string(),
  startedAt: v.pipe(
    v.string(),
    v.transform((value) => new Date(value)),
    v.date(),
  ),
  createdAt: v.pipe(
    v.string(),
    v.transform((value) => new Date(value)),
    v.date(),
  ),
  expiresAt: v.pipe(
    v.number(),
    v.transform((value) => new Date(value * 1000)),
    v.date(),
  ),
});
export type Session = v.InferOutput<typeof authorizerSchema>;

const schema = v.object({
  ...authorizerSchema.entries,
  data: v.partial(
    v.object({
      userAgent: v.string(),
      city: v.string(),
      country: v.string(),
      countryName: v.string(),
      region: v.string(),
      regionName: v.string(),
      longitude: v.number(),
      latitude: v.number(),
      postalCode: v.string(),
      timeZone: v.string(),
      androidViewer: v.boolean(),
      desktopViewer: v.boolean(),
      iosViewer: v.boolean(),
      mobileViewer: v.boolean(),
      smartTvViewer: v.boolean(),
      tabletViewer: v.boolean(),
    }),
  ),
  updatedAt: v.pipe(
    v.string(),
    v.transform((value) => new Date(value)),
    v.date(),
  ),
});
type NewSession = v.InferInput<typeof schema>;
export type UserSession = v.InferOutput<typeof schema>;

export class Sessions {
  constructor(
    private readonly props: {
      readonly dynamo: Pick<DynamoDBDocumentClient, "send">;
      readonly tableName: string;
      readonly userIdIndexName: string;
      /** Session lifetime in seconds. @default 2_592_000 (30 days) */
      readonly defaultMaxAge?: number;
      /** Rotation grace window in milliseconds — sessions younger than this are not rotated. @default 15_000 (15 s) */
      readonly refreshDrift?: number;
    },
  ) {}

  readonly getOne = async (id: string): Promise<Session> => {
    const { Item: item } = await this.props.dynamo.send(
      new GetCommand({
        TableName: this.props.tableName,
        Key: { id },
        ProjectionExpression: [
          "id",
          "expiresAt",
          "userId",
          "sessionId",
          "startedAt",
          "createdAt",
        ].join(),
      }),
    );

    if (item == null) throw new NotFoundError(`Session does not exist.`);

    return this.parseOne(item);
  };

  readonly listMany = async (userId: string) => {
    const keys = await this.fetchMany(userId);
    if (keys.length === 0) return [];

    const { Responses } = await this.props.dynamo.send(
      new BatchGetCommand({
        RequestItems: {
          [this.props.tableName]: {
            Keys: keys.map(({ id }) => ({ id })),
          },
        },
      }),
    );

    const items = Responses?.[this.props.tableName] ?? [];

    return items.map((item) => this.parseOneFull(item));
  };

  private readonly fetchMany = async (userId: string) => {
    const { Items: items = [] } = await this.props.dynamo.send(
      new QueryCommand({
        TableName: this.props.tableName,
        IndexName: this.props.userIdIndexName,
        KeyConditionExpression: "#userId = :userId",
        ExpressionAttributeNames: {
          "#userId": "userId",
        },
        ExpressionAttributeValues: {
          ":userId": userId,
        },
      }),
    );

    return items as { id: string; userId: string }[];
  };

  readonly createOne = async (props: {
    readonly userId: string;
    readonly maxAge?: number;
    readonly data: NewSession["data"];
  }) => {
    const { model, item, maxAge } = this.toNewSession({
      ...props,
      sessionId: undefined,
      startedAt: undefined,
    });

    await this.props.dynamo.send(
      new PutCommand({
        TableName: this.props.tableName,
        Item: item,
      }),
    );

    return { ...model, maxAge };
  };

  /**
   * Creates new session while invalidating the current session defined by `sessionId`.
   * The new session will expire at `maxAge`.
   *
   * Returns new `Session`.
   */
  readonly refresh = async (props: {
    session: Session;
    data: NewSession["data"];
    maxAge?: number;
  }) => {
    try {
      const start = new Date();
      const drift = this.props.refreshDrift ?? 15_000;

      const difference = start.getTime() - props.session.startedAt.getTime();
      if (difference < drift) {
        // Session is very young — skip rotation and return the existing session.
        // maxAge is capped to the remaining session lifetime so the cookie
        // expiry stays in sync. This cannot go negative in practice: the caller
        // (authorizer) guards against expired sessions before calling refresh,
        // and a session younger than `drift` (15 s) always has substantial time
        // remaining given the 30-day default TTL.
        const maxAge = Math.min(
          props.maxAge ?? this.props.defaultMaxAge ?? 2_592_000,
          Math.round(
            (props.session.expiresAt.getTime() - start.getTime()) / 1000,
          ),
        );

        return {
          newSession: props.session,
          maxAge,
        };
      }

      const { item, model, maxAge } = this.toNewSession({
        sessionId: props.session.sessionId,
        userId: props.session.userId,
        startedAt: props.session.startedAt,
        data: props.data,
      });

      const date = new Date(start);
      date.setUTCMilliseconds(
        date.getUTCMilliseconds() +
          Math.min(
            drift * 2,
            props.session.expiresAt.getTime() - start.getTime(),
          ),
      );
      const expiresAt = Math.round(date.getTime() / 1000);

      await this.props.dynamo.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: this.props.tableName,
                Key: {
                  id: props.session.id,
                },
                UpdateExpression: `SET #expiresAt = :expiresAt, #updatedAt = :updatedAt`,
                ConditionExpression: `#id = :id`,
                ExpressionAttributeNames: {
                  "#id": "id",
                  "#expiresAt": "expiresAt",
                  "#updatedAt": "updatedAt",
                },
                ExpressionAttributeValues: {
                  ":id": props.session.id,
                  ":expiresAt": expiresAt,
                  ":updatedAt": start.toISOString(),
                },
              },
            },
            {
              Put: {
                TableName: this.props.tableName,
                Item: item,
              },
            },
          ],
        }),
      );

      return { newSession: model, maxAge };
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException)
        throw new NotFoundError(
          `Cannot refresh session - session does not exist.`,
        );

      if (error instanceof TransactionCanceledException)
        throw new BadRequestError(
          `Cannot refresh session - transaction failed.`,
        );

      if (error instanceof BadRequestError) throw error;

      printError(error);

      throw new BadRequestError(`Unexpected error while refreshing session.`);
    }
  };

  readonly delete = async (id: string) => {
    await this.props.dynamo.send(
      new DeleteCommand({
        TableName: this.props.tableName,
        Key: { id },
      }),
    );
  };

  readonly deleteAllForUser = async (props: {
    userId: string;
    exceptSessionId?: string;
  }) => {
    const keys = await this.fetchMany(props.userId);
    const toDelete = props.exceptSessionId
      ? keys.filter(({ id }) => id !== props.exceptSessionId)
      : keys;

    if (toDelete.length === 0) return;

    for (const chunk of splitArrayToChunks(toDelete, 25)) {
      await this.props.dynamo.send(
        new BatchWriteCommand({
          RequestItems: {
            [this.props.tableName]: chunk.map(({ id }) => ({
              DeleteRequest: { Key: { id } },
            })),
          },
        }),
      );
    }
  };

  private readonly toNewSession = (props: {
    readonly userId: string;
    readonly sessionId: undefined | string;
    readonly startedAt: undefined | Date;
    readonly data: NewSession["data"];
    readonly maxAge?: number;
  }) => {
    const maxAge = props.maxAge ?? this.props.defaultMaxAge ?? 2_592_000;

    const createdAt = new Date().toISOString();
    const expiresAt = new Date();
    expiresAt.setUTCSeconds(expiresAt.getUTCSeconds() + maxAge);

    const item: NewSession = {
      id: randomBytes(32).toString("base64url"),
      sessionId: props.sessionId ?? randomBytes(32).toString("base64url"),
      expiresAt: Math.round(expiresAt.getTime() / 1000),
      userId: props.userId,
      data: props.data,
      createdAt,
      updatedAt: createdAt,
      startedAt: props.startedAt?.toISOString() ?? createdAt,
    };
    const model = this.parseOneFull(
      item,
      "Unexpected error occurred while creating session. Session has not been created.",
    );

    return { item, model, maxAge };
  };

  private readonly parseOne = (
    item: any,
    errorMessage: string = `Malformed session.`,
  ) => {
    const result = v.safeParse(authorizerSchema, item);
    if (!result.success) {
      console.error(v.flatten(result.issues));
      throw new BadRequestError(errorMessage);
    }

    return result.output;
  };

  private readonly parseOneFull = (
    item: any,
    errorMessage: string = `Malformed session.`,
  ) => {
    const result = v.safeParse(schema, item);
    if (!result.success) {
      console.error(v.flatten(result.issues));
      throw new BadRequestError(errorMessage);
    }

    return result.output;
  };

  static readonly dataFromCloudFrontHeaders = (
    headers: Partial<Record<string, string>>,
  ): NewSession["data"] => {
    const data = {
      androidViewer:
        headers["CloudFront-Is-Android-Viewer"] ??
        headers["cloudfront-is-android-viewer"],
      city:
        headers["CloudFront-Viewer-City"] ?? headers["cloudfront-viewer-city"],
      country:
        headers["CloudFront-Viewer-Country"] ??
        headers["cloudfront-viewer-country"],
      countryName:
        headers["CloudFront-Viewer-Country-Name"] ??
        headers["cloudfront-viewer-country-name"],
      desktopViewer:
        headers["CloudFront-Is-Desktop-Viewer"] ??
        headers["cloudfront-is-desktop-viewer"],
      iosViewer:
        headers["CloudFront-Is-IOS-Viewer"] ??
        headers["cloudfront-is-ios-viewer"],
      latitude:
        headers["CloudFront-Viewer-Latitude"] ??
        headers["cloudfront-viewer-latitude"],
      longitude:
        headers["CloudFront-Viewer-Longitude"] ??
        headers["cloudfront-viewer-longitude"],
      mobileViewer:
        headers["CloudFront-Is-Mobile-Viewer"] ??
        headers["cloudfront-is-mobile-viewer"],
      postalCode:
        headers["CloudFront-Viewer-Postal-Code"] ??
        headers["cloudfront-viewer-postal-code"],
      region:
        headers["CloudFront-Viewer-Country-Region"] ??
        headers["cloudfront-viewer-country-region"],
      regionName:
        headers["CloudFront-Viewer-Country-Region-Name"] ??
        headers["cloudfront-viewer-country-region-name"],
      smartTvViewer:
        headers["CloudFront-Is-SmartTV-Viewer"] ??
        headers["cloudfront-is-smarttv-viewer"],
      tabletViewer:
        headers["CloudFront-Is-Tablet-Viewer"] ??
        headers["cloudfront-is-tablet-viewer"],
      timeZone:
        headers["CloudFront-Viewer-Time-Zone"] ??
        headers["cloudfront-viewer-time-zone"],
      userAgent: headers["User-Agent"] ?? headers["user-agent"],
    };

    const result = v.safeParse(
      v.partial(
        v.object({
          userAgent: v.string(),
          city: v.string(),
          country: v.string(),
          countryName: v.string(),
          region: v.string(),
          regionName: v.string(),
          longitude: v.pipe(
            v.string(),
            v.transform((value) => Number(value)),
            v.number(),
          ),
          latitude: v.pipe(
            v.string(),
            v.transform((value) => Number(value)),
            v.number(),
          ),
          postalCode: v.string(),
          timeZone: v.string(),
          androidViewer: stringBoolean,
          desktopViewer: stringBoolean,
          iosViewer: stringBoolean,
          mobileViewer: stringBoolean,
          smartTvViewer: stringBoolean,
          tabletViewer: stringBoolean,
        }),
      ),
      data,
    );

    if (!result.success) {
      const issues = v.flatten(result.issues);

      const errorKeys = Object.keys(issues.nested ?? {});
      return Object.fromEntries(
        Object.entries(result.output as any).filter(
          ([key]) => !errorKeys.includes(key),
        ),
      );
    }

    return result.output;
  };
}
