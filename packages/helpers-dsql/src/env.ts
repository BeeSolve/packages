import * as v from "valibot";

/** Connection settings for one DSQL database role. */
export type DsqlConfig = {
  /** Cluster endpoint, for example `abc123.dsql.eu-central-1.on.aws`. */
  readonly host: string;
  readonly region: string;
  /** Database role: `admin` or a role mapped to the caller's IAM identity with `AWS IAM GRANT`. */
  readonly user: string;
  /** Local development only: credentials come from this shared-config profile. */
  readonly profile?: string | undefined;
};

/**
 * Valibot entries for the DSQL connection env vars. Spread them into an entry point's own env
 * schema so it validates everything in one place.
 */
export const dsqlEnvEntries: {
  readonly DSQL_ENDPOINT: v.StringSchema<undefined>;
  readonly DSQL_REGION: v.StringSchema<undefined>;
  readonly DSQL_DB_USER: v.StringSchema<undefined>;
  readonly AWS_PROFILE: v.OptionalSchema<v.StringSchema<undefined>, undefined>;
} = {
  DSQL_ENDPOINT: v.string(),
  DSQL_REGION: v.string(),
  DSQL_DB_USER: v.string(),
  AWS_PROFILE: v.optional(v.string()),
};

const dsqlEnvSchema = v.object(dsqlEnvEntries);

/** Reads {@link DsqlConfig} from `DSQL_ENDPOINT`, `DSQL_REGION`, `DSQL_DB_USER` and optional `AWS_PROFILE`. */
export function toDsqlConfig(env: Record<string, string | undefined> = process.env): DsqlConfig {
  const parsed = v.parse(dsqlEnvSchema, env);
  return {
    host: parsed.DSQL_ENDPOINT,
    region: parsed.DSQL_REGION,
    user: parsed.DSQL_DB_USER,
    profile: parsed.AWS_PROFILE || undefined,
  };
}
