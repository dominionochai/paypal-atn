/** JSON-compatible data accepted by the ATN API. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = Readonly<Record<string, JsonValue>>;

export interface RequestAuthorityInput {
  agentId: string;
  scope: readonly string[];
  /** USD amount as a decimal string; enforcement remains server-side. */
  ceiling: string;
  ttlSeconds: number;
}

export interface SpendInput {
  delegationId: string;
  /** USD amount as a decimal string; enforcement remains server-side. */
  amount: string;
  idempotencyKey: string;
}

export interface SubmitArtifactInput {
  escrowId: string;
  bytes: Uint8Array;
  metadata: JsonObject;
}

export interface CheckEscrowInput {
  escrowId: string;
}

export type AtNResponse = JsonObject;

export interface AtNClientOptions {
  /** Optional explicit URL. When omitted, ATN_BASE_URL is read from process.env. */
  baseUrl?: string;
  /** Fetch implementation, injectable for tests and alternate runtimes. */
  fetch?: typeof fetch;
}

export class AtNHttpError extends Error {
  readonly status: number;
  readonly responseBody: unknown;

  constructor(status: number, message: string, responseBody: unknown) {
    super(message);
    this.name = "AtNHttpError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

function isJsonObject(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseErrorMessage(payload: unknown, fallback: string): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "message" in payload &&
    typeof payload.message === "string"
  ) {
    return payload.message;
  }
  return fallback;
}

/** A thin HTTP transport. Authorization, limits, and all policy decisions stay on ATN. */
export class AtNClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AtNClientOptions = {}) {
    const environmentUrl =
      typeof process === "undefined" ? undefined : process.env.ATN_BASE_URL;
    const baseUrl = options.baseUrl ?? environmentUrl;

    if (!baseUrl) {
      throw new Error("Set ATN_BASE_URL or pass an explicit baseUrl to AtNClient.");
    }

    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;

    if (typeof this.fetchImpl !== "function") {
      throw new Error("A fetch implementation is required to use AtNClient.");
    }
  }

  requestAuthority(input: RequestAuthorityInput): Promise<AtNResponse> {
    return this.request("/v1/authority", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  spend(input: SpendInput): Promise<AtNResponse> {
    const { delegationId, amount, idempotencyKey } = input;
    return this.request("/v1/spend", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ delegationId, amount }),
    });
  }

  submitArtifact(input: SubmitArtifactInput): Promise<AtNResponse> {
    const form = new FormData();
    const byteBuffer = new Uint8Array(input.bytes).buffer;
    form.set("bytes", new Blob([byteBuffer]), "artifact.bin");
    form.set("metadata", JSON.stringify(input.metadata));

    return this.request(
      `/v1/escrows/${encodeURIComponent(input.escrowId)}/artifacts`,
      { method: "POST", body: form },
    );
  }

  checkEscrow(input: CheckEscrowInput): Promise<AtNResponse> {
    return this.request(`/v1/escrows/${encodeURIComponent(input.escrowId)}`, {
      method: "GET",
    });
  }

  private async request(path: string, init: RequestInit): Promise<AtNResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...init.headers,
      },
    });

    let payload: unknown;
    if (response.status !== 204) {
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
    }

    if (!response.ok) {
      throw new AtNHttpError(
        response.status,
        responseErrorMessage(
          payload,
          `ATN request failed with HTTP ${response.status}.`,
        ),
        payload,
      );
    }

    if (payload === undefined && response.status === 204) {
      return {};
    }
    if (!isJsonObject(payload)) {
      throw new TypeError("ATN returned a successful response that was not a JSON object.");
    }
    return payload;
  }
}
