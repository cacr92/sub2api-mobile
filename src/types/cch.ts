export type CchHealthComponent = {
  status: string;
  latencyMs?: number;
};

export type CchHealth = {
  status: string;
  timestamp?: string;
  version?: string;
  uptime?: number;
  components?: Partial<Record<'database' | 'redis' | 'proxy', CchHealthComponent>>;
};

export type CchServerIdentity = CchHealth & {
  latencyMs: number;
  checkedAt: string;
};

export type CchOverview = {
  concurrentSessions: number;
  todayRequests: number;
  todayCost: number;
  avgResponseTime: number;
  todayErrorRate: number;
  yesterdaySamePeriodRequests: number;
  yesterdaySamePeriodCost: number;
  yesterdaySamePeriodAvgResponseTime: number;
  recentMinuteRequests: number;
};

export type CchProviderStatistics = {
  todayCost: string | number;
  todayCalls: number;
  todayUpstreamCost?: string | number;
  upstreamCostStatus?: 'estimated' | 'partial' | 'unavailable';
  coveredRequestCount?: number;
  uncoveredRequestCount?: number;
  effectiveRateMultiplier?: string | number | null;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  cacheHitRate?: number;
  avgTtftMs?: number;
  successRate?: number | null;
  models?: CchProviderModelStatistics[];
  lastCallTime?: string | null;
  lastCallModel?: string | null;
};

export type CchProviderModelStatistics = {
  model: string;
  todayCalls: number;
  totalTokens: number;
  todayUpstreamCost: string | number;
  upstreamCostStatus: 'estimated' | 'partial' | 'unavailable';
  coveredRequestCount: number;
  uncoveredRequestCount: number;
};

export type CchUpstreamBillingProbeStatus = 'ok' | 'unsupported' | 'failed';

export type CchUpstreamBillingProbe = {
  status: CchUpstreamBillingProbeStatus;
  effectiveRateMultiplier?: number;
  lastAttemptAt: string;
  nextProbeAt: string;
  receivedAt?: string;
  freshUntil?: string;
  failureCount?: number;
  httpStatus?: number;
  lastError?: string;
};

export type CchUpstreamBillingProbeBatchResult = {
  total: number;
  ok: number;
  failed: number;
  unsupported: number;
  items: Array<{
    providerId: number;
    status: CchUpstreamBillingProbeStatus;
    effectiveRateMultiplier?: number;
    lastError?: string;
  }>;
};

export type CchSystemSettings = {
  autoSortProviderPriorityEnabled: boolean;
};

export type CchProvider = {
  id: number;
  name: string;
  isEnabled: boolean;
  priority: number;
  priorityLocked: boolean;
  providerType?: string;
  groupTag?: string | null;
  costMultiplier?: number;
  upstreamBillingProbeEnabled?: boolean;
  upstreamBillingProbe?: CchUpstreamBillingProbe | null;
  upstreamBillingProbeNextAt?: string | null;
  limit5hUsd?: number | null;
  limitDailyUsd?: number | null;
  limitWeeklyUsd?: number | null;
  limitMonthlyUsd?: number | null;
  limitTotalUsd?: number | null;
  limitConcurrentSessions?: number;
  statistics?: CchProviderStatistics;
};

export type CchProviderList = {
  items: CchProvider[];
};

export type CchProviderCircuit = {
  circuitState: 'closed' | 'open' | 'half-open';
  failureCount: number;
  lastFailureTime: number | null;
  circuitOpenUntil: number | null;
  recoveryMinutes: number | null;
};

export type CchProviderHealth = Record<string, CchProviderCircuit>;

export type CchProviderSlot = {
  providerId: number;
  name: string;
  usedSlots: number;
  totalSlots: number;
  totalVolume?: number;
};

export type CchProviderSlots = {
  items: CchProviderSlot[];
};

export type CchUser = {
  id: number;
  name: string;
  isEnabled?: boolean;
  keys?: Array<{ id?: number; isEnabled?: boolean }>;
};

export type CchUsersPage = {
  items: CchUser[];
  pageInfo: {
    nextCursor?: string | null;
    hasMore?: boolean;
    limit?: number;
  };
};

export type CchModelPriceSource = 'cloud' | 'litellm' | 'manual';

export type CchModelPrice = {
  id: number;
  modelName: string;
  priceData: Record<string, unknown>;
  source: CchModelPriceSource;
  createdAt: string;
  updatedAt: string;
};

export type CchModelPricePage = {
  items: CchModelPrice[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type CchProxyStatus = {
  users: Array<{
    userId: number;
    userName: string;
    activeCount: number;
    activeRequests?: Array<{
      requestId: number;
      keyName: string;
      providerId: number;
      providerName: string;
      model: string;
      startTime: number;
      duration: number;
    }>;
    lastRequest?: {
      requestId: number;
      keyName: string;
      providerId: number;
      providerName: string;
      model: string;
      endTime: number;
      elapsed: number;
    } | null;
  }>;
};

export type CchActivity = {
  id?: string;
  user?: string;
  model?: string;
  provider?: string;
  latency?: number;
  status?: number;
  cost?: number;
  startTime?: number;
};

export type CchRealtime = {
  metrics?: CchOverview;
  activityStream?: CchActivity[];
};
