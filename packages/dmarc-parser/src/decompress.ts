import { gunzipSync, inflateRawSync } from "node:zlib";

export function decompressGzip(buffer: Buffer): string {
  return gunzipSync(buffer).toString("utf-8");
}

export function decompressZip(buffer: Buffer): string {
  const entries = readZipEntries(buffer);
  const xmlEntry = entries.find((e) => e.name.endsWith(".xml"));

  if (xmlEntry == null) {
    throw new Error("No XML file found in zip archive");
  }

  return xmlEntry.data.toString("utf-8");
}

export function decompress(buffer: Buffer, filename: string): string {
  if (filename.endsWith(".gz")) {
    return decompressGzip(buffer);
  }
  if (filename.endsWith(".zip")) {
    return decompressZip(buffer);
  }
  return buffer.toString("utf-8");
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

function readZipEntries(buffer: Buffer): Array<ZipEntry> {
  const entries: Array<ZipEntry> = [];

  // Find End of Central Directory record (EOCD)
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (
      buffer[i] === 0x50 &&
      buffer[i + 1] === 0x4b &&
      buffer[i + 2] === 0x05 &&
      buffer[i + 3] === 0x06
    ) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error("Invalid zip: cannot find End of Central Directory record");
  }

  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);

  let offset = centralDirOffset;

  for (let i = 0; i < totalEntries; i++) {
    // Central directory file header signature
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Invalid zip: bad central directory header");
    }

    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf-8", offset + 46, offset + 46 + nameLength);
    const compressionMethod = buffer.readUInt16LE(offset + 10);

    // Read from local file header
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;

    let data: Buffer;
    if (compressionMethod === 0) {
      // Stored (no compression)
      data = buffer.subarray(dataOffset, dataOffset + uncompressedSize);
    } else if (compressionMethod === 8) {
      // Deflate
      const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
      data = inflateRawSync(compressed);
    } else {
      throw new Error(`Unsupported zip compression method: ${compressionMethod}`);
    }

    entries.push({ name, data });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}
