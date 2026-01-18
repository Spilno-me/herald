interface ReflectPayload {
  insight: string;
  feeling: 'success' | 'stuck';
  context: {
    org: string;
    project: string;
  };
}

interface PatternsPayload {
  topic?: string;
  context: {
    org: string;
    project: string;
  };
}

interface Pattern {
  id: string;
  insight: string;
  feeling: string;
  createdAt: string;
}

interface PatternsResponse {
  patterns: Pattern[];
}

interface ReflectResponse {
  success: boolean;
  id?: string;
  message?: string;
}

export class HeraldClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async reflect(payload: ReflectPayload): Promise<ReflectResponse> {
    const response = await fetch(`${this.baseUrl}/v1/reflect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Herald API error: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<ReflectResponse>;
  }

  async patterns(payload: PatternsPayload): Promise<PatternsResponse> {
    const response = await fetch(`${this.baseUrl}/v1/patterns`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Herald API error: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<PatternsResponse>;
  }
}
