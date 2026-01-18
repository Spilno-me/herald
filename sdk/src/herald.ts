import type {
  HeraldConfig,
  ReflectParams,
  ReflectResponse,
  PatternsParams,
  Pattern,
  FeedbackParams,
  HeraldError,
} from "./types";

const DEFAULT_BASE_URL = "https://api.getceda.com";

export class Herald {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly context: HeraldConfig["context"];

  constructor(config: HeraldConfig) {
    if (!config.apiKey) {
      throw new Error("apiKey is required");
    }
    if (!config.context?.org) {
      throw new Error("context.org is required");
    }

    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.context = config.context;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      ...((options.headers as Record<string, string>) ?? {}),
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      let errorData: HeraldError;
      try {
        errorData = await response.json();
      } catch {
        errorData = {
          message: `HTTP ${response.status}: ${response.statusText}`,
          status: response.status,
        };
      }
      const error = new Error(errorData.message) as Error & HeraldError;
      error.code = errorData.code;
      error.status = response.status;
      throw error;
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  async reflect(params: ReflectParams): Promise<ReflectResponse> {
    if (!params.session) {
      throw new Error("session is required");
    }
    if (!params.feeling) {
      throw new Error("feeling is required");
    }
    if (!params.insight) {
      throw new Error("insight is required");
    }

    return this.request<ReflectResponse>("/v1/reflect", {
      method: "POST",
      body: JSON.stringify({
        ...params,
        context: this.context,
      }),
    });
  }

  async patterns(params?: PatternsParams): Promise<Pattern[]> {
    return this.request<Pattern[]>("/v1/patterns", {
      method: "POST",
      body: JSON.stringify({
        ...params,
        context: this.context,
      }),
    });
  }

  async feedback(params: FeedbackParams): Promise<void> {
    if (!params.patternId) {
      throw new Error("patternId is required");
    }
    if (!params.outcome) {
      throw new Error("outcome is required");
    }

    await this.request<void>("/v1/feedback", {
      method: "POST",
      body: JSON.stringify({
        ...params,
        context: this.context,
      }),
    });
  }
}
