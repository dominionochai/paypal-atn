import { createHash } from 'node:crypto';

export type InspectionOutcome = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

export interface InspectionResult {
  outcome: InspectionOutcome;
  reasons: string[];
  artifactSha256: string;
  artifactBytes: number;
}

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_FORBIDDEN_HINTS = ['PyFunc', 'PythonOp', 'StringNormalizer', 'Tokenizer'];
const ACCEPTED_MEDIA_TYPES = new Set([
  'application/octet-stream',
  'application/x-onnx',
  'model/onnx',
]);

class MalformedProtobufError extends Error {}

interface VarintResult {
  value: bigint;
  next: number;
}

function readVarint(bytes: Buffer, offset: number, end: number): VarintResult {
  let value = 0n;
  let shift = 0n;

  for (let index = 0; index < 10; index += 1) {
    if (offset >= end) throw new MalformedProtobufError('Truncated varint');
    const byte = bytes[offset];
    if (byte === undefined) throw new RangeError('unexpected end of buffer');
    if (index === 9 && (byte & 0xfe) !== 0) {
      throw new MalformedProtobufError('Varint exceeds 64 bits');
    }
    value |= BigInt(byte & 0x7f) << shift;
    offset += 1;
    if ((byte & 0x80) === 0) return { value, next: offset };
    shift += 7n;
  }

  throw new MalformedProtobufError('Varint exceeds 10 bytes');
}

function safeNumber(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new MalformedProtobufError('Protobuf integer exceeds safe bounds');
  }
  return Number(value);
}

type FieldVisitor = (
  fieldNumber: number,
  wireType: number,
  integerValue: bigint | undefined,
  payloadStart: number,
  payloadEnd: number,
) => void;

function walkFields(bytes: Buffer, start: number, end: number, visit: FieldVisitor): void {
  let offset = start;
  while (offset < end) {
    const tag = readVarint(bytes, offset, end);
    offset = tag.next;
    const tagNumber = safeNumber(tag.value);
    const fieldNumber = Math.floor(tagNumber / 8);
    const wireType = tagNumber & 7;
    if (fieldNumber < 1 || fieldNumber > 0x1fffffff) {
      throw new MalformedProtobufError('Invalid protobuf field number');
    }

    let integerValue: bigint | undefined;
    let payloadStart = offset;
    let payloadEnd = offset;

    if (wireType === 0) {
      const value = readVarint(bytes, offset, end);
      integerValue = value.value;
      offset = value.next;
    } else if (wireType === 1) {
      if (end - offset < 8) throw new MalformedProtobufError('Truncated fixed64');
      offset += 8;
    } else if (wireType === 2) {
      const length = readVarint(bytes, offset, end);
      offset = length.next;
      const size = safeNumber(length.value);
      if (size > end - offset) throw new MalformedProtobufError('Truncated length-delimited field');
      payloadStart = offset;
      payloadEnd = offset + size;
      offset = payloadEnd;
    } else if (wireType === 5) {
      if (end - offset < 4) throw new MalformedProtobufError('Truncated fixed32');
      offset += 4;
    } else {
      throw new MalformedProtobufError('Unsupported protobuf wire type');
    }

    visit(fieldNumber, wireType, integerValue, payloadStart, payloadEnd);
  }
}

interface ModelMetadata {
  irVersion?: string;
  producerName?: string;
  opsetVersions: string[];
}

function decodeProtoString(bytes: Buffer, start: number, end: number): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start, end));
  } catch {
    throw new MalformedProtobufError('Invalid UTF-8 protobuf string');
  }
}

function parseModel(bytes: Buffer): ModelMetadata {
  const metadata: ModelMetadata = { opsetVersions: [] };
  walkFields(bytes, 0, bytes.length, (fieldNumber, wireType, integerValue, payloadStart, payloadEnd) => {
    if (fieldNumber === 1) {
      if (wireType !== 0 || integerValue === undefined) {
        throw new MalformedProtobufError('ir_version has the wrong wire type');
      }
      metadata.irVersion = integerValue.toString();
    } else if (fieldNumber === 2) {
      if (wireType !== 2) throw new MalformedProtobufError('producer_name has the wrong wire type');
      metadata.producerName = decodeProtoString(bytes, payloadStart, payloadEnd);
    } else if (fieldNumber === 8) {
      if (wireType !== 2) throw new MalformedProtobufError('opset_import has the wrong wire type');
      walkFields(bytes, payloadStart, payloadEnd, (nestedNumber, nestedWireType, nestedValue) => {
        if (nestedNumber === 2) {
          if (nestedWireType !== 0 || nestedValue === undefined) {
            throw new MalformedProtobufError('opset version has the wrong wire type');
          }
          metadata.opsetVersions.push(nestedValue.toString());
        }
      });
    }
  });
  return metadata;
}

function addReason(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

export function inspectArtifact(input: {
  bytes: Buffer;
  declaredMediaType: string;
  maxBytes?: number;
  expectedSha256?: string;
  forbiddenOpcodeHints?: string[];
}): InspectionResult {
  let size = 0;
  let digest = createHash('sha256').update(Buffer.alloc(0)).digest('hex');
  const reasons: string[] = [];

  try {
    const { bytes, declaredMediaType } = input;
    size = bytes.length;
    digest = createHash('sha256').update(bytes).digest('hex');
    const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
      addReason(reasons, 'PARSE_ERROR');
    } else if (size > maxBytes) {
      addReason(reasons, 'OVERSIZE');
    }

    const expectedSha256 = input.expectedSha256?.trim().toLowerCase();
    if (expectedSha256 !== undefined && expectedSha256 !== digest) {
      addReason(reasons, 'HASH_MISMATCH');
    }

    const mediaType = declaredMediaType.trim().toLowerCase();
    if (!ACCEPTED_MEDIA_TYPES.has(mediaType)) addReason(reasons, 'UNEXPECTED_MEDIA_TYPE');

    const hints = input.forbiddenOpcodeHints ?? DEFAULT_FORBIDDEN_HINTS;
    for (const hint of hints) {
      if (hint.length > 0 && bytes.indexOf(Buffer.from(hint, 'utf8')) !== -1) {
        addReason(reasons, `FORBIDDEN_OP:${hint}`);
      }
    }

    let parsed = false;
    let bestEffortProducerReason: string | undefined;
    const bestEffortOpsetReasons: string[] = [];
    if (size === 0) {
      addReason(reasons, 'EMPTY_ARTIFACT');
    } else if (reasons.includes('OVERSIZE')) {
      // Do not parse an artifact which already exceeds the caller's explicit bound.
    } else {
      try {
        const metadata = parseModel(bytes);
        parsed = true;
        if (metadata.irVersion !== undefined) addReason(reasons, `INFO_IR_VERSION:${metadata.irVersion}`);
        if (metadata.producerName !== undefined) {
          const printableName = JSON.stringify(metadata.producerName).slice(0, 128);
          bestEffortProducerReason = `INFO_PRODUCER_NAME:${printableName}`;
        }
        for (const version of metadata.opsetVersions) {
          if (version !== undefined) bestEffortOpsetReasons.push(`INFO_OPSET_VERSION:${version}`);
        }
      } catch (error) {
        addReason(reasons, error instanceof MalformedProtobufError ? 'MALFORMED_PROTOBUF' : 'PARSE_ERROR');
      }
    }

    const hasFailure = reasons.some(
      (reason) => reason === 'OVERSIZE' || reason === 'HASH_MISMATCH' || reason.startsWith('FORBIDDEN_OP:'),
    );
    const hasUncertainty = reasons.some((reason) => !reason.startsWith('INFO_'));
    const outcome = hasFailure ? 'FAIL' : parsed && !hasUncertainty ? 'PASS' : 'INCONCLUSIVE';
    if (outcome !== 'FAIL') {
      if (bestEffortProducerReason !== undefined) addReason(reasons, bestEffortProducerReason);
      for (const reason of bestEffortOpsetReasons) addReason(reasons, reason);
    }
    return {
      outcome,
      reasons,
      artifactSha256: digest,
      artifactBytes: size,
    };
  } catch {
    addReason(reasons, 'PARSE_ERROR');
    return { outcome: 'INCONCLUSIVE', reasons, artifactSha256: digest, artifactBytes: size };
  }
}