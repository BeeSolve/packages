import { createHash } from "node:crypto";

import type { CloudFrontRequestEvent, CloudFrontRequestResult } from "aws-lambda";

export const handler = async (event: CloudFrontRequestEvent): Promise<CloudFrontRequestResult> => {
  const request = event.Records[0]!.cf.request;
  if (request.body?.data) {
    const buf =
      request.body.encoding === "base64"
        ? Buffer.from(request.body.data, "base64")
        : Buffer.from(request.body.data, "utf-8");
    const hash = createHash("sha256").update(buf).digest("hex");
    request.headers["x-amz-content-sha256"] = [{ key: "x-amz-content-sha256", value: hash }];
  }
  return request;
};
