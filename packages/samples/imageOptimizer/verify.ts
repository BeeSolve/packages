const baseUrl = (process.argv[2] ?? process.env.IMAGE_OPTIMIZER_URL ?? "").replace(/\/+$/, "");
if (baseUrl === "") {
  console.error("Usage: bun imageOptimizer/verify.ts https://<distribution>.cloudfront.net");
  process.exit(1);
}

const imageAccept = "image/webp,image/avif,image/*,*/*;q=0.8";
const documentAccept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

interface Expectation {
  name: string;
  path: string;
  accept?: string;
  status: number;
  contentType?: string;
  outcome?: string | null;
  width?: number;
  height?: number;
  frames?: number;
  alpha?: boolean;
  bodyStartsWith?: string;
  edgeGenerated?: boolean;
}

const expectations: Array<Expectation> = [
  {
    name: "WebP for images",
    path: "/assets/photos/01.jpeg?w=300",
    accept: imageAccept,
    status: 200,
    contentType: "image/webp",
    outcome: "optimized",
    width: 300,
    height: 225,
  },
  {
    name: "JPEG for documents",
    path: "/assets/photos/01.jpeg?w=300",
    accept: documentAccept,
    status: 200,
    contentType: "image/jpeg",
    width: 300,
    height: 225,
  },
  {
    name: "never enlarges",
    path: "/assets/photos/01.jpeg?fit=max&h=8000&w=8000",
    status: 200,
    width: 4032,
    height: 3024,
  },
  {
    name: "EXIF orientation",
    path: "/assets/photos/04.jpeg?w=300",
    accept: imageAccept,
    status: 200,
    width: 300,
    height: 400,
  },
  {
    name: "stretch",
    path: "/assets/photos/01.jpeg?fit=scale&h=200&w=800",
    accept: imageAccept,
    status: 200,
    width: 800,
    height: 200,
  },
  {
    name: "pixel ratio",
    path: "/assets/photos/01.jpeg?dpr=2&fit=max&w=300",
    accept: imageAccept,
    status: 200,
    width: 600,
    height: 450,
  },
  {
    name: "rotation",
    path: "/assets/photos/01.jpeg?fit=max&rot=90&w=400",
    accept: imageAccept,
    status: 200,
    width: 400,
    height: 533,
  },
  {
    name: "forced PNG",
    path: "/assets/photos/01.jpeg?fit=max&fm=png&w=200",
    accept: imageAccept,
    status: 200,
    contentType: "image/png",
    width: 200,
    height: 150,
  },
  {
    name: "placeholder",
    path: "/assets/photos/01.jpeg?fit=max&placeholder=1&w=400",
    status: 200,
    contentType: "text/plain; charset=utf-8",
    outcome: "placeholder",
    bodyStartsWith: "data:image/",
  },
  {
    name: "unsupported parameter",
    path: "/assets/photos/01.jpeg?crop=faces",
    status: 400,
    edgeGenerated: true,
  },
  { name: "invalid value", path: "/assets/photos/01.jpeg?w=abc", status: 400, edgeGenerated: true },
  { name: "value above limit", path: "/assets/photos/01.jpeg?w=9000", status: 400, outcome: null },
  { name: "traversal", path: "/assets/photos%2F..%2F01.jpeg", status: 400, edgeGenerated: true },
  { name: "missing image", path: "/assets/photos/missing.jpeg?w=100", status: 404, outcome: null },
  { name: "outside the prefix", path: "/secret.jpg", status: 404, edgeGenerated: true },
  {
    name: "mislabelled GIF passthrough",
    path: "/assets/files/mislabelled.jpg?w=100",
    status: 200,
    contentType: "image/gif",
    outcome: "passthrough; reason=unsupported-format; format=gif",
  },
  {
    name: "PDF from the bucket",
    path: "/assets/files/document.pdf",
    status: 200,
    contentType: "application/pdf",
    outcome: null,
  },
  {
    name: "animated WebP passthrough",
    path: "/assets/fixtures/animated-large.webp?fit=max&fm=jpg&w=200",
    accept: imageAccept,
    status: 200,
    contentType: "image/webp",
    outcome: "passthrough; reason=unsupported-format; format=animated-webp",
    width: 640,
    height: 360,
    frames: 24,
  },
  {
    name: "animated GIF from the bucket",
    path: "/assets/fixtures/animated-large.gif?w=200",
    status: 200,
    contentType: "image/gif",
    outcome: null,
    width: 640,
    height: 360,
    frames: 24,
  },
  {
    name: "PNG alpha kept as WebP",
    path: "/assets/fixtures/alpha.png?fit=max&w=300",
    accept: imageAccept,
    status: 200,
    contentType: "image/webp",
    width: 300,
    height: 169,
    alpha: true,
  },
  {
    name: "PNG alpha kept as PNG",
    path: "/assets/fixtures/alpha.png?fit=max&fm=png&w=300",
    accept: imageAccept,
    status: 200,
    contentType: "image/png",
    alpha: true,
  },
  {
    name: "WebP alpha kept",
    path: "/assets/fixtures/alpha.webp?fit=max&w=300",
    accept: imageAccept,
    status: 200,
    contentType: "image/webp",
    alpha: true,
  },
  { name: "test page", path: "/assets/test/index.html", status: 200, contentType: "text/html" },
];

const failures: Array<string> = [];
for (const expectation of expectations) {
  const problems = await check(expectation);
  const label = `${expectation.name} (${expectation.path})`;
  if (problems.length === 0) {
    console.log(`ok   ${label}`);
  } else {
    console.log(`FAIL ${label}: ${problems.join("; ")}`);
    failures.push(label);
  }
}

const cacheKey = "/assets/photos/02.jpeg?h=200&w=100";
await fetch(`${baseUrl}${cacheKey}`, { headers: { accept: imageAccept } });
const reordered = await fetch(
  `${baseUrl}/assets/photos/02.jpeg?W=0100&H=200&utm_source=x&fit=clip`,
  {
    headers: { accept: imageAccept },
  },
);
const hit = reordered.headers.get("x-cache")?.startsWith("Hit") === true;
console.log(`${hit ? "ok  " : "FAIL"} canonical cache key (${reordered.headers.get("x-cache")})`);
if (!hit) failures.push("canonical cache key");

console.log(`\n${expectations.length + 1 - failures.length} passed, ${failures.length} failed`);
process.exit(failures.length === 0 ? 0 : 1);

async function check(expectation: Expectation): Promise<Array<string>> {
  const response = await fetch(`${baseUrl}${expectation.path}`, {
    headers: expectation.accept == null ? {} : { accept: expectation.accept },
  });
  const body = new Uint8Array(await response.arrayBuffer());
  const problems: Array<string> = [];
  if (response.status !== expectation.status) problems.push(`status ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (expectation.contentType != null && !contentType.startsWith(expectation.contentType)) {
    problems.push(`content-type ${contentType}`);
  }
  const outcome = response.headers.get("x-image-optimizer");
  if (expectation.outcome !== undefined && outcome !== expectation.outcome) {
    problems.push(`x-image-optimizer ${outcome}`);
  }
  if (
    expectation.edgeGenerated === true &&
    response.headers.get("x-cache") !== "FunctionGeneratedResponse from cloudfront"
  ) {
    problems.push(`not answered at the edge (${response.headers.get("x-cache")})`);
  }
  if (
    expectation.bodyStartsWith != null &&
    !new TextDecoder().decode(body.subarray(0, 32)).startsWith(expectation.bodyStartsWith)
  ) {
    problems.push("unexpected body");
  }
  const info = describe(body);
  if (expectation.width != null && info.width !== expectation.width)
    problems.push(`width ${info.width}`);
  if (expectation.height != null && info.height !== expectation.height)
    problems.push(`height ${info.height}`);
  if (expectation.frames != null && info.frames !== expectation.frames)
    problems.push(`frames ${info.frames}`);
  if (expectation.alpha != null && info.alpha !== expectation.alpha)
    problems.push(`alpha ${info.alpha}`);
  return problems;
}

interface ImageInfo {
  width?: number;
  height?: number;
  frames?: number;
  alpha?: boolean;
}

function describe(bytes: Uint8Array): ImageInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length > 30 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP")
    return describeWebp(bytes);
  if (bytes.length > 10 && ascii(0, 3) === "GIF") {
    let frames = 0;
    for (let index = 0; index < bytes.length - 2; index++) {
      if (bytes[index] === 0x21 && bytes[index + 1] === 0xf9 && bytes[index + 2] === 0x04) frames++;
    }
    return { width: view.getUint16(6, true), height: view.getUint16(8, true), frames };
  }
  if (bytes.length > 26 && bytes[0] === 0x89 && ascii(1, 4) === "PNG") {
    const colorType = bytes[25] ?? 0;
    return {
      width: view.getUint32(16),
      height: view.getUint32(20),
      frames: 1,
      alpha: colorType === 4 || colorType === 6,
    };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset < bytes.length - 9) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1] ?? 0;
      if (marker >= 0xc0 && marker <= 0xc2) {
        return {
          height: view.getUint16(offset + 5),
          width: view.getUint16(offset + 7),
          frames: 1,
          alpha: false,
        };
      }
      offset += 2 + view.getUint16(offset + 2);
    }
  }
  return {};
}

function describeWebp(bytes: Uint8Array): ImageInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  const uint24 = (offset: number) =>
    (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
  const chunk = ascii(12, 16);
  if (chunk === "VP8X") {
    let frames = 0;
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      if (ascii(offset, offset + 4) === "ANMF") frames++;
      const size = view.getUint32(offset + 4, true);
      offset += 8 + size + (size % 2);
    }
    const flags = bytes[20] ?? 0;
    return {
      width: uint24(24) + 1,
      height: uint24(27) + 1,
      frames: Math.max(1, frames),
      alpha: (flags & 0x10) !== 0,
    };
  }
  if (chunk === "VP8L") {
    const bits = view.getUint32(21, true);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
      frames: 1,
      alpha: ((bits >> 28) & 1) === 1,
    };
  }
  return {
    width: view.getUint16(26, true) & 0x3fff,
    height: view.getUint16(28, true) & 0x3fff,
    frames: 1,
    alpha: false,
  };
}
