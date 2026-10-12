import { PhysicalName } from "aws-cdk-lib";
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
  { glueName: "sc_bytes", deliveryField: "sc-bytes", type: "bigint" },
  { glueName: "c_ip", deliveryField: "c-ip", type: "string" },
  { glueName: "cs_method", deliveryField: "cs-method", type: "string" },
  { glueName: "cs_host", deliveryField: "cs(Host)", type: "string" },
  { glueName: "cs_uri_stem", deliveryField: "cs-uri-stem", type: "string" },
  { glueName: "sc_status", deliveryField: "sc-status", type: "int" },
  { glueName: "cs_referer", deliveryField: "cs(Referer)", type: "string" },
  { glueName: "cs_user_agent", deliveryField: "cs(User-Agent)", type: "string" },
  { glueName: "cs_uri_query", deliveryField: "cs-uri-query", type: "string" },
  { glueName: "cs_cookie", deliveryField: "cs(Cookie)", type: "string" },
  { glueName: "x_edge_result_type", deliveryField: "x-edge-result-type", type: "string" },
  { glueName: "x_edge_request_id", deliveryField: "x-edge-request-id", type: "string" },
  { glueName: "x_host_header", deliveryField: "x-host-header", type: "string" },
  { glueName: "cs_protocol", deliveryField: "cs-protocol", type: "string" },
  { glueName: "cs_bytes", deliveryField: "cs-bytes", type: "bigint" },
  { glueName: "time_taken", deliveryField: "time-taken", type: "double" },
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
  { glueName: "time_to_first_byte", deliveryField: "time-to-first-byte", type: "double" },
  {
    glueName: "x_edge_detailed_result_type",
    deliveryField: "x-edge-detailed-result-type",
    type: "string",
  },
  { glueName: "sc_content_type", deliveryField: "sc-content-type", type: "string" },
  { glueName: "sc_content_len", deliveryField: "sc-content-len", type: "bigint" },
  { glueName: "sc_range_start", deliveryField: "sc-range-start", type: "bigint" },
  { glueName: "sc_range_end", deliveryField: "sc-range-end", type: "bigint" },
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

const partitionKeys = [
  { name: "year", type: "string" },
  { name: "month", type: "string" },
  { name: "day", type: "string" },
  { name: "hour", type: "string" },
] as const;

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
   * Set this to:
   * - (a) **pin an existing bucket's name when upgrading a brownfield stack.** A log
   *   bucket deployed by an earlier version without an explicit `BucketName` has a
   *   CloudFormation auto-assigned name. Once the bucket is referenced cross-stack the
   *   default ({@link PhysicalName.GENERATE_IF_NEEDED}) materializes a *different*
   *   generated name, and because a bucket name is immutable this forces a replacement.
   *   Pass the existing physical bucket name here so the upgrade is a no-op on the bucket.
   * - (b) **control the name for cross-region v2 delivery**, where a stable, explicit
   *   bucket name can be preferable to a generated one.
   *
   * When omitted, defaults to {@link PhysicalName.GENERATE_IF_NEEDED}, which only
   * materializes a name when the bucket is referenced cross-environment. This preserves
   * the current greenfield behavior (no explicit `BucketName` in same-stack synthesis).
   *
   * @default PhysicalName.GENERATE_IF_NEEDED
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

  constructor(scope: Construct, id: string, props: CloudFrontAccessLoggingSettingsProps) {
    super(scope, id);

    const logBucket = new Bucket(this, "AccessLogs", {
      objectOwnership: ObjectOwnership.OBJECT_WRITER,
      // Allows the v2 delivery destination to reference this bucket's ARN from a
      // different stack (e.g. a us-east-1 delivery scope) without a cross-environment
      // token. GENERATE_IF_NEEDED only emits an explicit name when actually referenced
      // cross-stack, so same-region (same-stack) synthesis is unchanged. Brownfield
      // consumers whose deployed bucket has an auto-generated name must pin it via
      // `logBucketName` to avoid a replacement when it first gets referenced cross-stack.
      bucketName: props.logBucketName ?? PhysicalName.GENERATE_IF_NEEDED,
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
            location: `s3://${logBucket.bucketName}/${this.outputPrefix}/`,
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
            "storage.location.template": `s3://${logBucket.bucketName}/${this.outputPrefix}/\${year}/\${month}/\${day}/\${hour}`,
          },
          tableType: "EXTERNAL_TABLE",
        },
      });
      glueTable.addResourceDependency(glueDatabase);

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
   */
  readonly enableV2Logging = ({
    distributionArn,
    deliveryScope,
  }: {
    distributionArn: string;
    deliveryScope?: Construct;
  }): void => {
    const scope = deliveryScope ?? this;

    const deliverySource = new CfnDeliverySource(scope, "V2DeliverySource", {
      name: `${this.node.id}-v2-source`,
      logType: "ACCESS_LOGS",
      resourceArn: distributionArn,
    });

    const deliveryDestination = new CfnDeliveryDestination(scope, "V2DeliveryDestination", {
      name: `${this.node.id}-v2-destination`,
      destinationResourceArn: this.logBucket.bucketArn,
      outputFormat: "parquet",
    });

    const delivery = new CfnDelivery(scope, "V2Delivery", {
      deliverySourceName: deliverySource.name,
      deliveryDestinationArn: deliveryDestination.attrArn,
      s3EnableHiveCompatiblePath: true,
      s3SuffixPath: `${this.outputPrefix}/{DistributionId}/{yyyy}/{MM}/{dd}/{HH}`,
      recordFields: this.deliveryRecordFields,
    });
    delivery.addResourceDependency(deliverySource);
    delivery.addResourceDependency(deliveryDestination);
  };
}
