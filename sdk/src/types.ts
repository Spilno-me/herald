export interface HeraldConfig {
  apiKey: string;
  baseUrl?: string;
  context: {
    org: string;
    project?: string;
    user?: string;
  };
}

export interface ReflectParams {
  session: string;
  feeling: "success" | "stuck";
  insight: string;
}

export interface ReflectResponse {
  id: string;
}

export interface PatternsParams {
  topic?: string;
}

export interface Pattern {
  id: string;
  topic: string;
  insight: string;
  feeling: "success" | "stuck";
  createdAt: string;
  org: string;
  project?: string;
  user?: string;
}

export interface FeedbackParams {
  patternId: string;
  outcome: "helped" | "didnt_help";
}

export interface HeraldError {
  message: string;
  code?: string;
  status?: number;
}
