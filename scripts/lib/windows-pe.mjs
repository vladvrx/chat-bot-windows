const PE_SIGNATURE = 0x00004550;
const PE32_MAGIC = 0x10b;
const PE32_PLUS_MAGIC = 0x20b;
const CERTIFICATE_DIRECTORY_INDEX = 4;

export function inspectPeCertificate(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError("PE input must be a Buffer.");
  if (bytes.length < 0x40 || bytes.readUInt16LE(0) !== 0x5a4d) throw new Error("Expected an MZ executable.");
  const peOffset = bytes.readUInt32LE(0x3c);
  if (peOffset + 24 > bytes.length || bytes.readUInt32LE(peOffset) !== PE_SIGNATURE) throw new Error("Expected a PE executable.");
  const optionalHeader = peOffset + 24;
  const magic = bytes.readUInt16LE(optionalHeader);
  const dataDirectory = magic === PE32_PLUS_MAGIC
    ? optionalHeader + 112
    : magic === PE32_MAGIC
      ? optionalHeader + 96
      : null;
  if (dataDirectory == null) throw new Error(`Unsupported PE optional-header magic 0x${magic.toString(16)}.`);
  const directoryOffset = dataDirectory + CERTIFICATE_DIRECTORY_INDEX * 8;
  if (directoryOffset + 8 > bytes.length) throw new Error("PE certificate directory is truncated.");
  const fileOffset = bytes.readUInt32LE(directoryOffset);
  const size = bytes.readUInt32LE(directoryOffset + 4);
  if ((fileOffset === 0) !== (size === 0)) throw new Error("PE certificate directory is inconsistent.");
  if (size > 0 && fileOffset + size > bytes.length) throw new Error("PE certificate data exceeds the executable.");
  return { peOffset, magic, directoryOffset, fileOffset, size, endOffset: fileOffset + size };
}

export function stripPeCertificate(bytes) {
  const certificate = inspectPeCertificate(bytes);
  if (certificate.size === 0) return Buffer.from(bytes);
  if (certificate.endOffset !== bytes.length) throw new Error("Refusing to strip a PE certificate that is not the final file payload.");
  const stripped = Buffer.from(bytes.subarray(0, certificate.fileOffset));
  stripped.writeUInt32LE(0, certificate.directoryOffset);
  stripped.writeUInt32LE(0, certificate.directoryOffset + 4);
  return stripped;
}
