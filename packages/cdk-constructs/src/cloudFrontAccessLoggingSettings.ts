import { isNotNil } from "@beesolve/helpers";
import { CfnNamedQuery, CfnWorkGroup } from "aws-cdk-lib/aws-athena";
import type { DistributionProps } from "aws-cdk-lib/aws-cloudfront";
import { CfnDatabase, CfnTable } from "aws-cdk-lib/aws-glue";
import { Bucket, ObjectOwnership } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

/**
 * List of all CloudFront access log columns.
 *
 * @link https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/AccessLogs.html#BasicDistributionFileFormat
 */
const cloudFrontAccessLogColumns = [
  { name: "date", type: "date" },
  { name: "time", type: "string" },
  { name: "x-edge-location", type: "string" },
  { name: "sc-bytes", type: "string" },
  { name: "c-ip", type: "string" },
  { name: "cs-method", type: "string" },
  { name: "cs(Host)", type: "string" },
  { name: "cs-uri-stem", type: "string" },
  { name: "sc-status", type: "string" },
  { name: "cs(Referer)", type: "string" },
  { name: "cs(User-Agent)", type: "string" },
  { name: "cs-uri-query", type: "string" },
  { name: "cs(Cookie)", type: "string" },
  { name: "x-edge-result-type", type: "string" },
  { name: "x-edge-request-id", type: "string" },
  { name: "x-host-header", type: "string" },
  { name: "cs-protocol", type: "string" },
  { name: "cs-bytes", type: "string" },
  { name: "time-taken", type: "string" },
  { name: "x-forwarded-for", type: "string" },
  { name: "ssl-protocol", type: "string" },
  { name: "ssl-cipher", type: "string" },
  { name: "x-edge-response-result-type", type: "string" },
  { name: "cs-protocol-version", type: "string" },
  { name: "fle-status", type: "string" },
  { name: "fle-encrypted-fields", type: "string" },
  { name: "c-port", type: "string" },
  { name: "time-to-first-byte", type: "string" },
  { name: "x-edge-detailed-result-type", type: "string" },
  { name: "sc-content-type", type: "string" },
  { name: "sc-content-len", type: "string" },
  { name: "sc-range-start", type: "string" },
  { name: "sc-range-end", type: "string" },
] as const;
type CloudFrontAccessLogColumn =
  (typeof cloudFrontAccessLogColumns)[number]["name"];

const columnDefinitionByKey = Object.fromEntries(
  cloudFrontAccessLogColumns.map((value) => [value.name, value]),
);

export interface CloudFrontAccessLoggingSettingsProps
  extends Pick<DistributionProps, "logFilePrefix" | "logIncludesCookies"> {
  /**
   * Athena related settings.
   *
   * When not defined, no glue nor athena are being deployed.
   *
   * @default undefined
   */
  readonly athena?: {
    /**
     * Current account number.
     */
    readonly account: string;
    /**
     * Provide custom glue database name.
     *
     * @default cf_logs_db
     */
    readonly glueDbName?: string;
    /**
     * Provide custom glue table name.
     *
     * @default cf_logs_table
     */
    readonly glueTableName?: string;
    /**
     * Provide custom athena workgroup name.
     *
     * @default cf_workgroup
     */
    readonly workGroupName?: string;
    /**
     * You can pick individual columns from the access logs which will be stored inside the glue table.
     *
     * @default all available columns
     */
    readonly columns?: CloudFrontAccessLogColumn[];
    /**
     * When `true` sample query is created within the Athena.
     *
     * @default true
     */
    readonly createSampleQuery?: boolean;
  };
}

export class CloudFrontAccessLoggingSettings extends Construct {
  readonly cloudFrontLoggingSettings: Pick<
    DistributionProps,
    "logBucket" | "logFilePrefix" | "enableLogging" | "logIncludesCookies"
  >;

  constructor(
    scope: Construct,
    id: string,
    props: CloudFrontAccessLoggingSettingsProps,
  ) {
    super(scope, id);

    const logBucket = new Bucket(this, "AccessLogs", {
      objectOwnership: ObjectOwnership.OBJECT_WRITER,
    });

    if (props.athena != null) {
      const databaseName = props.athena.glueDbName ?? "cf_logs_db";
      const tableName = props.athena.glueTableName ?? "cf_logs_table";
      const workgroupName = props.athena.workGroupName ?? "cf_workgroup";

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
          description: "Glue table for CloudFront access logs",
          storageDescriptor: {
            columns:
              props.athena.columns == null
                ? [...cloudFrontAccessLogColumns]
                : Array.from(new Set(props.athena.columns))
                    .map((column) => columnDefinitionByKey[column])
                    .filter(isNotNil),
            location: `s3://${logBucket.bucketName}/${props.logFilePrefix ?? ""}`,
            inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
            outputFormat:
              "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
            serdeInfo: {
              serializationLibrary:
                "org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe",
              parameters: {
                "serialization.format": "\t",
                "field.delim": "\t",
              },
            },
          },
          parameters: {
            "skip.header.line.count": 2,
          },
          tableType: "EXTERNAL_TABLE",
        },
      });
      glueTable.addDependency(glueDatabase);

      const athenaBucket = new Bucket(this, "AthenaBucket");
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
        sampleQuery.addDependency(workgroup);
      }
    }

    this.cloudFrontLoggingSettings = {
      enableLogging: true,
      logBucket,
      logFilePrefix: props.logFilePrefix,
      logIncludesCookies: props.logIncludesCookies ?? false,
    };
  }
}
