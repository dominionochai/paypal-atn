export interface AtnClientOptions {
  baseUrl: string;
  authorityId: string;
  timeoutMs?: number;
}

export interface OpenChannelRequest {
  payerAgentId: string;
  payeeAgentId: string;
  payerPublicKey: string;
  ceiling: number;
  ttlSeconds: number;
}

export interface OpenChannelResult {
  channelId: string;
  ceiling: number;
  expiresAt: number;
}

export interface ChannelState {
  id: string;
  spent: number;
  ceiling: number;
  status: string;
  lastNonce: number;
  expiresAt: number;
}

export interface VoucherPayload {
  channelId: string;
  payeeAgentId: string;
  cumulativeAmount: number;
  nonce: number;
  issuedAt: number;
}

export interface VoucherSubmission {
  payload: VoucherPayload;
  signature: string;
}

export interface VoucherAccepted {
  ok: true;
  spent: number;
  ceiling: number;
}

export interface SettlementResult {
  channelId: string;
  amount: number;
  mode: string;
  adapterRef: string | null;
  idempotencyKey: string;
}

export class AtnHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string | undefined;

  constructor(status: number, code: string, detail?: string) {
    super(code);
    this.name = "AtnHttpError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export class AtnProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AtnProtocolError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new AtnProtocolError("ATN returned invalid JSON.");
  }
  if (!isRecord(value)) {
    throw new AtnProtocolError("ATN returned a JSON value that is not an object.");
  }
  return value;
}

function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string") {
    throw new AtnProtocolError(`Invalid ATN response: ${field} must be a string.`);
  }
  return value;
}

function requireNumber(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new AtnProtocolError(`Invalid ATN response: ${field} must be a finite number.`);
  }
  return value;
}

function requireNullableString(body: Record<string, unknown>, field: string): string | null {
  const value = body[field];
  if (value !== null && typeof value !== "string") {
    throw new AtnProtocolError(`Invalid ATN response: ${field} must be a string or null.`);
  }
  return value;
}

export class AtnClient {
  private readonly baseUrl: string;
  private readonly authorityId: string;
  private readonly timeoutMs: number;

  constructor(options: AtnClientOptions) {
    if (options.baseUrl.trim().length === 0) {
      throw new TypeError("ATN baseUrl must not be empty.");
    }
    if (options.authorityId.trim().length === 0) {
      throw new TypeError("ATN authorityId must not be empty.");
    }
    const timeoutMs = options.timeoutMs ?? 10000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new RangeError("ATN timeoutMs must be a positive finite number.");
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.authorityId = options.authorityId;
    this.timeoutMs = timeoutMs;
  }

  async openChannel(req: OpenChannelRequest): Promise<OpenChannelResult> {
    const body = await this.request(
      "/v1/channels",
      "POST",
      201,
      JSON.stringify({
        payerAgentId: req.payerAgentId,
        payeeAgentId: req.payeeAgentId,
        payerPublicKey: req.payerPublicKey,
        ceiling: req.ceiling,
        ttlSeconds: req.ttlSeconds,
      }),
    );
    return {
      channelId: requireString(body, "channelId"),
      ceiling: requireNumber(body, "ceiling"),
      expiresAt: requireNumber(body, "expiresAt"),
    };
  }

  async getChannel(channelId: string): Promise<ChannelState> {
    const body = await this.request(
      `/v1/channels/${encodeURIComponent(channelId)}`,
      "GET",
      200,
    );
    return {
      id: requireString(body, "id"),
      spent: requireNumber(body, "spent"),
      ceiling: requireNumber(body, "ceiling"),
      status: requireString(body, "status"),
      lastNonce: requireNumber(body, "lastNonce"),
      expiresAt: requireNumber(body, "expiresAt"),
    };
  }

  async submitVoucher(
    channelId: string,
    voucher: VoucherSubmission,
  ): Promise<VoucherAccepted> {
    const body = await this.request(
      `/v1/channels/${encodeURIComponent(channelId)}/vouchers`,
      "POST",
      200,
      JSON.stringify({
        payload: {
          channelId: voucher.payload.channelId,
          payeeAgentId: voucher.payload.payeeAgentId,
          cumulativeAmount: voucher.payload.cumulativeAmount,
          nonce: voucher.payload.nonce,
          issuedAt: voucher.payload.issuedAt,
        },
        signature: voucher.signature,
      }),
    );
    if (body.ok !== true) {
      throw new AtnProtocolError("Invalid ATN response: ok must be true.");
    }
    return {
      ok: true,
      spent: requireNumber(body, "spent"),
      ceiling: requireNumber(body, "ceiling"),
    };
  }

  async settleChannel(
    channelId: string,
    idempotencyKey: string,
  ): Promise<SettlementResult> {
    const body = await this.request(
      `/v1/channels/${encodeURIComponent(channelId)}/settle`,
      "POST",
      200,
      JSON.stringify({ idempotencyKey }),
      { "x-atn-authority": this.authorityId },
    );
    return {
      channelId: requireString(body, "channelId"),
      amount: requireNumber(body, "amount"),
      mode: requireString(body, "mode"),
      adapterRef: requireNullableString(body, "adapterRef"),
      idempotencyKey: requireString(body, "idempotencyKey"),
    };
  }

  private async request(
    path: string,
    method: "GET" | "POST",
    expectedStatus: number,
    body?: string,
    headers?: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const payload = await readJsonObject(response);
    if (!response.ok) {
      const code = payload.error;
      if (typeof code !== "string") {
        throw new AtnProtocolError("Invalid ATN error response: error must be a string.");
      }
      const detail = payload.detail;
      if (detail !== undefined && typeof detail !== "string") {
        throw new AtnProtocolError("Invalid ATN error response: detail must be a string when present.");
      }
      throw new AtnHttpError(response.status, code, detail);
    }
    if (response.status !== expectedStatus) {
      throw new AtnProtocolError(
        `ATN returned HTTP ${response.status}; expected HTTP ${expectedStatus}.`,
      );
    }
    return payload;
  }
}
