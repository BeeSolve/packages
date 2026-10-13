import { CfnNamedQuery, CfnWorkGroup } from "aws-cdk-lib/aws-athena";
import type { DistributionProps } from "aws-cdk-lib/aws-cloudfront";
import { CfnDatabase, CfnTable } from "aws-cdk-lib/aws-glue";
import { CfnDelivery, CfnDeliveryDestination, CfnDeliverySource } from "aws-cdk-lib/aws-logs";
import { Bucket, ObjectOwnership } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

interface StandardLogField {
  /**
   * Normalized Athena/Parquet column name (lowercase, hyphens folded to
   * underscores, parentheses stripped). Used for the Glue table columns and
   * matched verbatim by the analytics processor's queries.
   */
  readonly glueName: string;
  /**
   * CloudFront standard-logs field token accepted by the CloudWatch Logs
   * delivery API (`CfnDelivery.recordFields`).
   */
  readonly deliveryField: string;
  readonly type: string;
}

/**
 * The CloudFront standard logging v2 field set — the single source of truth for
 * both the Glue table columns (via {@link StandardLogField.glueName}) and the
 * delivery record fields (via {@link StandardLogField.deliveryField}).
 *
 * Standard logging v2 exposes the same 33 legacy fields plus a `timestamp`
 * (epoch) field; the difference from the legacy format is Parquet output, Hive
 * partitioning, and the ability to deliver a selected subset. There is no
 * separate v2 field list.
 *
 * @link https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/standard-logging.html#standard-logging-fields
 */
const standardLogFields = [
  { glueName: "timestamp", deliveryField: "timestamp", type: "string" },
  { glueName: "date", deliveryField: "date", type: "string" },
  { glueName: "time", deliveryField: "time", type: "string" },
  { glueName: "x_edge_location", deliveryField: "x-edge-location", type: "string" },
  { glueName: "sc_bytes", deliveryField: "sc-bytes", type: "string" },
  { glueName: "c_ip", deliveryField: "c-ip", type: "string" },
  { glueName: "cs_method", deliveryField: "cs-method", type: "string" },
  { glueName: "cs_host", deliveryField: "cs(Host)", type: "string" },
  { glueName: "cs_uri_stem", deliveryField: "cs-uri-stem", type: "string" },
  { glueName: "sc_status", deliveryField: "sc-status", type: "string" },
  { glueName: "cs_referer", deliveryField: "cs(Referer)", type: "string" },
  { glueName: "cs_user_agent", deliveryField: "cs(User-Agent)", type: "string" },
  { glueName: "cs_uri_query", deliveryField: "cs-uri-query", type: "string" },
  { glueName: "cs_cookie", deliveryField: "cs(Cookie)", type: "string" },
  { glueName: "x_edge_result_type", deliveryField: "x-edge-result-type", type: "string" },
  { glueName: "x_edge_request_id", deliveryField: "x-edge-request-id", type: "string" },
  { glueName: "x_host_header", deliveryField: "x-host-header", type: "string" },
  { glueName: "cs_protocol", deliveryField: "cs-protocol", type: "string" },
  { glueName: "cs_bytes", deliveryField: "cs-bytes", type: "string" },
  { glueName: "time_taken", deliveryField: "time-taken", type: "string" },
  { glueName: "x_forwarded_for", deliveryField: "x-forwarded-for", type: "string" },
  { glueName: "ssl_protocol", deliveryField: "ssl-protocol", type: "string" },
  { glueName: "ssl_cipher", deliveryField: "ssl-cipher", type: "string" },
  {
    glueName: "x_edge_response_result_type",
    deliveryField: "x-edge-response-result-type",
    type: "string",
  },
  { glueName: "cs_protocol_version", deliveryField: "cs-protocol-version", type: "string" },
  { glueName: "fle_status", deliveryField: "fle-status", type: "string" },
  { glueName: "fle_encrypted_fields", deliveryField: "fle-encrypted-fields", type: "string" },
  { glueName: "c_port", deliveryField: "c-port", type: "string" },
  { glueName: "time_to_first_byte", deliveryField: "time-to-first-byte", type: "string" },
  {
    glueName: "x_edge_detailed_result_type",
    deliveryField: "x-edge-detailed-result-type",
    type: "string",
  },
  { glueName: "sc_content_type", deliveryField: "sc-content-type", type: "string" },
  { glueName: "sc_content_len", deliveryField: "sc-content-len", type: "string" },
  { glueName: "sc_range_start", deliveryField: "sc-range-start", type: "string" },
  { glueName: "sc_range_end", deliveryField: "sc-range-end", type: "string" },
] as const;

/**
 * The normalized Athena/Parquet column names consumers select from via
 * `athena.recordFields`. Matching these to the analytics processor's query
 * column names is what lets its queries resolve against the Glue table.
 */
export type CloudFrontAccessLogField = (typeof standardLogFields)[number]["glueName"];

const fieldByGlueName: Record<string, StandardLogField> = Object.fromEntries(
  standardLogFields.map((field) => [field.glueName, field]),
);

/**
 * Partition keys for the Glue table, in path order. CloudFront v2 Hive-compatible delivery
 * writes a `DistributionId=<dist>` segment ahead of the time partitions, but because each log
 * bucket/prefix holds a single distribution, that segment is baked into the table location as a
 * literal path element rather than declared as a partition column. Declaring it as a partition
 * without a matching `${distributionid}` placeholder in `storage.location.template` makes Athena
 * reject queries with `INVALID_TABLE_PROPERTY: The 'storage.location.template' table property
 * must contain templates for all partition columns!`. Only the time partitions remain.
 */
const partitionKeys = [
  { name: "year", type: "string" },
  { name: "month", type: "string" },
  { name: "day", type: "string" },
  { name: "hour", type: "string" },
] as const;

/**
 * Parses the distribution id (e.g. `E123ABC`) from a CloudFront distribution ARN of the form
 * `arn:aws:cloudfront::<account>:distribution/<DISTID>` by taking the substring after the last
 * `/`.
 */
function parseDistributionId(distributionArn: string): string {
  const distributionId = distributionArn.split("/").at(-1);
  if (distributionId == null || distributionId === "") {
    throw new Error(`Could not parse a distribution id from ARN: ${distributionArn}`);
  }
  return distributionId;
}

/**
 * The fixed S3 prefix that CloudWatch Logs vended delivery writes CloudFront v2 Parquet objects
 * under: `s3://<bucket>/AWSLogs/aws-account-id=<account>/CloudFront/<outputPrefix>/`.
 *
 * CloudWatch Logs automatically prepends `AWSLogs/aws-account-id=<account>/CloudFront/` to the
 * configured `s3SuffixPath`, so the Glue table location must include it. This prefix sits above
 * the `DistributionId=<dist>/year=/month=/day=/hour=/` Hive partition segments.
 */
function v2LocationPrefix({
  bucketName,
  account,
  outputPrefix,
}: {
  bucketName: string;
  account: string;
  outputPrefix: string;
}): string {
  return `s3://${bucketName}/AWSLogs/aws-account-id=${account}/CloudFront/${outputPrefix}/`;
}

interface CloudFrontAccessLoggingAthenaProps {
  /**
   * Current account number.
   */
  readonly account: string;
  /**
   * Provide a custom Glue database name.
   *
   * @default cf_logs_db
   */
  readonly glueDbName?: string;
  /**
   * Provide a custom Glue table name for the Parquet standard logging v2 data.
   *
   * @default cf_logs_table
   */
  readonly glueTableName?: string;
  /**
   * Provide a custom Athena workgroup name.
   *
   * @default cf_workgroup
   */
  readonly workGroupName?: string;
  /**
   * S3 key prefix (within the log bucket) that v2 Parquet objects land under.
   *
   * @default "v2"
   */
  readonly outputPrefix?: string;
  /**
   * Subset of normalized log fields to deliver and project in the Glue table.
   * Selecting fewer fields keeps the Parquet objects small, which makes Athena
   * scans cheaper and faster.
   *
   * @default all 33 fields
   */
  readonly recordFields?: ReadonlyArray<CloudFrontAccessLogField>;
  /**
   * When `true` a sample query targeting the Parquet table is created in Athena.
   *
   * @default true
   */
  readonly createSampleQuery?: boolean;
}

export interface CloudFrontAccessLoggingSettingsProps extends Pick<
  DistributionProps,
  "logFilePrefix" | "logIncludesCookies"
> {
  /**
   * Athena related settings.
   *
   * When provided, the v2 Parquet pipeline (Glue database + Parquet Glue table +
   * Athena workgroup + results bucket) is provisioned. When omitted, only the
   * log bucket is created.
   *
   * @default undefined
   */
  readonly athena?: CloudFrontAccessLoggingAthenaProps;
  /**
   * Explicit physical name for the access-log S3 bucket.
   *
   * Use this for **greenfield** stacks where a stable, human-readable bucket name is
   * preferable to a CloudFormation-generated one. Setting it emits an explicit
   * `BucketName` in the synthesized template.
   *
   * **Do not** set this to adopt an existing (brownfield) log bucket that was deployed
   * without an explicit `BucketName`: adding a `BucketName` to an already-unnamed bucket
   * is a replacement regardless of the value, which fails on a retained bucket. To keep an
   * existing unnamed bucket in place while still delivering v2 logs across stacks/regions,
   * leave this unset and pass `logBucketArn` to {@link enableV2Logging} instead.
   *
   * When omitted, no `BucketName` is emitted and CloudFormation keeps assigning the name,
   * so an existing unnamed bucket is never replaced.
   *
   * @default undefined (no explicit `BucketName`)
   */
  readonly logBucketName?: string;
}

export class CloudFrontAccessLoggingSettings extends Construct {
  readonly cloudFrontLoggingSettings: Pick<
    DistributionProps,
    "logBucket" | "logFilePrefix" | "enableLogging" | "logIncludesCookies"
  >;

  /**
   * The S3 bucket that holds the v2 Parquet access logs.
   */
  readonly logBucket: Bucket;

  /**
   * The S3 bucket that stores Athena query results, when Athena is configured.
   */
  readonly athenaResultsBucket?: Bucket;

  /**
   * Name of the Glue database, or `undefined` when Athena is not configured.
   */
  readonly glueDatabaseName?: string;

  /**
   * Name of the Parquet Glue table, or `undefined` when Athena is not configured.
   */
  readonly glueTableName?: string;

  /**
   * Name of the Athena workgroup, or `undefined` when Athena is not configured.
   */
  readonly workgroupName?: string;

  private readonly outputPrefix: string;
  private readonly deliveryRecordFields: Array<string>;
  /**
   * The Parquet Glue table, retained so that {@link enableV2Logging} can finalize the
   * distribution-id-dependent partitioning once the distribution ARN is known. `undefined`
   * when Athena is not configured.
   */
  private readonly glueTable?: CfnTable;
  /**
   * The account id used to build the fixed `AWSLogs/aws-account-id=<account>/CloudFront/`
   * prefix that CloudWatch Logs vended delivery prepends. `undefined` when Athena is not
   * configured.
   */
  private readonly athenaAccount?: string;

  constructor(scope: Construct, id: string, props: CloudFrontAccessLoggingSettingsProps) {
    super(scope, id);

    const logBucket = new Bucket(this, "AccessLogs", {
      objectOwnership: ObjectOwnership.OBJECT_WRITER,
      // Only emit an explicit BucketName when the consumer opts in via `logBucketName`.
      // Omitting it entirely (rather than using GENERATE_IF_NEEDED) means an existing
      // brownfield bucket deployed without a name is never forced into a replacement.
      // Cross-stack/region v2 delivery references the bucket via an explicit ARN string
      // (`enableV2Logging({ logBucketArn })`), so no cross-stack reference is created that
      // would otherwise force a physical name.
      ...(props.logBucketName != null ? { bucketName: props.logBucketName } : {}),
    });
    this.logBucket = logBucket;
    this.outputPrefix = props.athena?.outputPrefix ?? "v2";

    const selectedFields =
      props.athena?.recordFields == null
        ? [...standardLogFields]
        : Array.from(new Set(props.athena.recordFields)).map((glueName) => {
            const field = fieldByGlueName[glueName];
            if (field == null) {
              throw new Error(`Unknown CloudFront access log field: ${glueName}`);
            }
            return field;
          });
    this.deliveryRecordFields = selectedFields.map((field) => field.deliveryField);

    if (props.athena != null) {
      const databaseName = props.athena.glueDbName ?? "cf_logs_db";
      const tableName = props.athena.glueTableName ?? "cf_logs_table";
      const workgroupName = props.athena.workGroupName ?? "cf_workgroup";
      this.glueDatabaseName = databaseName;
      this.glueTableName = tableName;
      this.workgroupName = workgroupName;

      const glueDatabase = new CfnDatabase(this, "AccessLogsGlueDb", {
        catalogId: props.athena.account,
        databaseInput: {
          description: "Glue DB for CloudFront access logs",
          name: databaseName,
        },
      });

      const glueTable = new CfnTable(this, "AccessLogsGlueTable", {
        catalogId: props.athena.account,
        databaseName,
        tableInput: {
          name: tableName,
          description: "Glue table for CloudFront standard logging v2 (Parquet)",
          storageDescriptor: {
            columns: selectedFields.map((field) => ({ name: field.glueName, type: field.type })),
            // The distribution-dependent location is finalized in `enableV2Logging`, once the
            // distribution ARN is known. Until then the location points at the fixed
            // vended-delivery prefix without the `DistributionId=<dist>/` segment.
            location: v2LocationPrefix({
              bucketName: logBucket.bucketName,
              account: props.athena.account,
              outputPrefix: this.outputPrefix,
            }),
            inputFormat: "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
            outputFormat: "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
            serdeInfo: {
              serializationLibrary: "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
            },
          },
          partitionKeys: partitionKeys.map((partitionKey) => ({
            name: partitionKey.name,
            type: partitionKey.type,
          })),
          parameters: {
            classification: "parquet",
            "projection.enabled": "true",
            "projection.year.type": "integer",
            "projection.year.range": "2020,2100",
            "projection.year.digits": "4",
            "projection.month.type": "integer",
            "projection.month.range": "1,12",
            "projection.month.digits": "2",
            "projection.day.type": "integer",
            "projection.day.range": "1,31",
            "projection.day.digits": "2",
            "projection.hour.type": "integer",
            "projection.hour.range": "0,23",
            "projection.hour.digits": "2",
            // `distributionid` projection and `storage.location.template` are set in
            // `enableV2Logging`, where the distribution id becomes available.
            "storage.location.template": v2LocationPrefix({
              bucketName: logBucket.bucketName,
              account: props.athena.account,
              outputPrefix: this.outputPrefix,
            }),
          },
          tableType: "EXTERNAL_TABLE",
        },
      });
      glueTable.addResourceDependency(glueDatabase);
      this.glueTable = glueTable;
      this.athenaAccount = props.athena.account;

      const athenaBucket = new Bucket(this, "AthenaBucket");
      this.athenaResultsBucket = athenaBucket;
      const workgroup = new CfnWorkGroup(this, "Workgroup", {
        name: workgroupName,
        workGroupConfiguration: {
          resultConfiguration: {
            outputLocation: `s3://${athenaBucket.bucketName}/`,
          },
        },
      });

      if (props.athena.createSampleQuery !== false) {
        const sampleQuery = new CfnNamedQuery(this, "SampleNamedQuery", {
          name: "sample_query",
          queryString: `SELECT * FROM "${databaseName}"."${tableName}" limit 25;`,
          database: databaseName,
          workGroup: workgroup.name,
        });
        sampleQuery.addResourceDependency(workgroup);
      }
    }

    this.cloudFrontLoggingSettings = {
      enableLogging: false,
      logIncludesCookies: props.logIncludesCookies ?? false,
    };
  }

  /**
   * Wires the CloudFront standard logging v2 delivery pipeline for a distribution.
   *
   * Call this after the distribution exists, passing its ARN. Separating this from the
   * constructor avoids a cyclic dependency between the distribution (which needs
   * {@link cloudFrontLoggingSettings}) and the delivery source (which needs the
   * distribution ARN).
   *
   * @param deliveryScope CloudFront v2 log delivery resources must be created in
   * us-east-1. When the construct itself is not in us-east-1, pass a scope (e.g. a
   * us-east-1 stack) where the delivery source/destination/delivery are created. The
   * destination references the (possibly cross-region) log bucket ARN. Defaults to `this`.
   * @param logBucketArn Explicit S3 bucket ARN for the delivery destination. Pass this
   * (instead of relying on the construct's bucket object) when the log bucket lives in a
   * different stack/region than `deliveryScope`, to avoid a cross-stack reference that would
   * otherwise force an explicit bucket name. Defaults to the construct's own log bucket ARN.
   */
  readonly enableV2Logging = ({
    distributionArn,
    deliveryScope,
    logBucketArn,
  }: {
    distributionArn: string;
    deliveryScope?: Construct;
    logBucketArn?: string;
  }): void => {
    const scope = deliveryScope ?? this;

    this.finalizeGlueTablePartitioning(distributionArn);

    const deliverySource = new CfnDeliverySource(scope, "V2DeliverySource", {
      name: `${this.node.id}-v2-source`,
      logType: "ACCESS_LOGS",
      resourceArn: distributionArn,
    });

    const deliveryDestination = new CfnDeliveryDestination(scope, "V2DeliveryDestination", {
      name: `${this.node.id}-v2-destination`,
      destinationResourceArn: logBucketArn ?? this.logBucket.bucketArn,
      outputFormat: "parquet",
    });

    const delivery = new CfnDelivery(scope, "V2Delivery", {
      deliverySourceName: deliverySource.name,
      deliveryDestinationArn: deliveryDestination.attrArn,
      s3EnableHiveCompatiblePath: true,
      // CloudWatch Logs vended delivery automatically prepends
      // `AWSLogs/aws-account-id=<account>/CloudFront/` to this suffix, and Hive-compatible
      // mode renders each `{Token}` as a `Token=value` segment. The resolved key is therefore
      // `AWSLogs/aws-account-id=<account>/CloudFront/<outputPrefix>/DistributionId=<dist>/year=/month=/day=/hour=/<file>`,
      // which is the confirmed real layout. The suffix is correct as-is; only the Glue table
      // (finalized above) had to change to match it.
      s3SuffixPath: `${this.outputPrefix}/{DistributionId}/{yyyy}/{MM}/{dd}/{HH}`,
      recordFields: this.deliveryRecordFields,
    });
    delivery.addResourceDependency(deliverySource);
    delivery.addResourceDependency(deliveryDestination);
  };

  /**
   * Finalizes the distribution-dependent location on the Parquet Glue table.
   *
   * The table is created in the constructor, but the distribution id only becomes available
   * when {@link enableV2Logging} is called. Each log bucket/prefix holds exactly one
   * distribution, so the id is baked into the table as a literal `DistributionId=<dist>/` path
   * segment on both the base `StorageDescriptor.Location` and `storage.location.template`,
   * rather than being declared as a partition column. The partitions therefore stay limited to
   * `year/month/day/hour`, and every partition column has a matching `${...}` placeholder in the
   * template — which is what Athena requires (otherwise it rejects queries with
   * `INVALID_TABLE_PROPERTY: ... must contain templates for all partition columns!`).
   *
   * No-op when Athena is not configured (no table exists).
   */
  private finalizeGlueTablePartitioning(distributionArn: string): void {
    if (this.glueTable == null || this.athenaAccount == null) {
      return;
    }
    const distributionId = parseDistributionId(distributionArn);
    const locationPrefix = v2LocationPrefix({
      bucketName: this.logBucket.bucketName,
      account: this.athenaAccount,
      outputPrefix: this.outputPrefix,
    });
    const baseLocation = `${locationPrefix}DistributionId=${distributionId}/`;
    const locationTemplate = `${locationPrefix}DistributionId=${distributionId}/year=\${year}/month=\${month}/day=\${day}/hour=\${hour}`;

    this.glueTable.addPropertyOverride("TableInput.StorageDescriptor.Location", baseLocation);
    this.glueTable.addPropertyOverride(
      "TableInput.Parameters.storage\\.location\\.template",
      locationTemplate,
    );
  }
}
