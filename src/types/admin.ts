export type ApiEnvelope<T> = {
  code: number;
  message: string;
  reason?: string;
  metadata?: Record<string, string>;
  data?: T;
};

export type PaginatedData<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
};

export type DashboardStats = {
  total_users: number;
  today_new_users: number;
  active_users: number;
  total_api_keys: number;
  active_api_keys: number;
  total_accounts: number;
  normal_accounts: number;
  error_accounts: number;
  total_requests: number;
  total_cost: number; // 标准计费
  total_tokens: number;
  today_requests: number;
  today_cost: number; // 今日标准计费
  today_actual_cost: number; // 今日实际扣除
  today_tokens: number;
  today_input_tokens?: number;
  today_output_tokens?: number;
  today_cache_read_tokens?: number;
  rpm: number;
  tpm: number;
};

export type TrendPoint = {
  date: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  cost: number;
  actual_cost: number;
};

export type DashboardTrend = {
  start_date: string;
  end_date: string;
  granularity: 'day' | 'hour' | string;
  trend: TrendPoint[];
};

export type ModelStat = {
  model: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  cost: number;
  actual_cost: number;
};

export type DashboardModelStats = {
  start_date: string;
  end_date: string;
  models: ModelStat[];
};

export type UsageStats = {
  total_requests?: number;
  total_tokens?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_cache_tokens?: number;
  total_cache_read_tokens?: number;
  total_cache_creation_tokens?: number;
  total_cost?: number;
  total_actual_cost?: number;
  total_account_cost?: number;
  average_duration_ms?: number;
};

export type AdminUsageLog = {
  account_id: number;
  first_token_ms?: number | null;
};

export type DashboardSnapshot = {
  trend?: TrendPoint[];
  models?: ModelStat[];
  groups?: Array<{
    group_id?: number;
    group_name?: string;
    requests?: number;
    total_tokens?: number;
    total_cost?: number;
    total_actual_cost?: number;
  }>;
};

/** 模型广场中一档按 Token 区间展示的价格。价格单位与服务端一致，均为 USD/token。 */
export type ModelPlazaPricingInterval = {
  min_tokens: number;
  max_tokens: number | null;
  tier_label?: string;
  input_price: number | null;
  output_price: number | null;
  cache_write_price: number | null;
  cache_read_price: number | null;
  per_request_price: number | null;
};

/** 模型广场模型的用户侧定价字段白名单。 */
export type ModelPlazaPricing = {
  billing_mode: string;
  input_price: number | null;
  output_price: number | null;
  cache_write_price: number | null;
  cache_read_price: number | null;
  image_input_price: number | null;
  image_output_price: number | null;
  per_request_price: number | null;
  intervals: ModelPlazaPricingInterval[];
};

/** LiteLLM 官方参考价，字段为空表示官方数据未覆盖。 */
export type ModelPlazaOfficialPricing = {
  input_price: number | null;
  output_price: number | null;
  cache_write_price: number | null;
  cache_write_1h_price?: number | null;
  cache_read_price: number | null;
};

export type ModelPlazaModel = {
  name: string;
  platform: string;
  pricing: ModelPlazaPricing | null;
  official_pricing: ModelPlazaOfficialPricing | null;
};

export type ModelPlazaGroup = {
  id: number;
  name: string;
  description: string;
  platform: string;
  subscription_type: string;
  rate_multiplier: number;
  user_rate_multiplier?: number;
  peak_rate_enabled: boolean;
  peak_start: string;
  peak_end: string;
  peak_rate_multiplier: number;
  is_exclusive: boolean;
  models: ModelPlazaModel[];
};

export type ModelPlazaResponse = {
  description: string;
  groups: ModelPlazaGroup[];
};

export type ServerIdentity = {
  version: string;
  latency_ms: number;
  checked_at: string;
};

export type OpsRateSummary = {
  current: number;
  peak: number;
  avg: number;
};

export type OpsPercentiles = {
  p50_ms?: number | null;
  p90_ms?: number | null;
  p95_ms?: number | null;
  p99_ms?: number | null;
  avg_ms?: number | null;
  max_ms?: number | null;
};

export type OpsSystemMetricsSnapshot = {
  id: number;
  created_at: string;
  window_minutes: number;
  cpu_usage_percent?: number | null;
  memory_used_mb?: number | null;
  memory_total_mb?: number | null;
  memory_usage_percent?: number | null;
  db_ok?: boolean | null;
  redis_ok?: boolean | null;
  db_max_open_conns?: number | null;
  redis_pool_size?: number | null;
  redis_conn_total?: number | null;
  redis_conn_idle?: number | null;
  db_conn_active?: number | null;
  db_conn_idle?: number | null;
  db_conn_waiting?: number | null;
  goroutine_count?: number | null;
  concurrency_queue_depth?: number | null;
  account_switch_count?: number | null;
};

export type OpsJobHeartbeat = {
  job_name: string;
  last_run_at?: string | null;
  last_success_at?: string | null;
  last_error_at?: string | null;
  last_error?: string | null;
  last_duration_ms?: number | null;
  last_result?: string | null;
  updated_at: string;
};

export type OpsDashboardOverview = {
  start_time: string;
  end_time: string;
  platform: string;
  group_id?: number | null;
  health_score?: number;
  system_metrics?: OpsSystemMetricsSnapshot | null;
  job_heartbeats?: OpsJobHeartbeat[] | null;
  success_count: number;
  error_count_total: number;
  business_limited_count: number;
  error_count_sla: number;
  request_count_total: number;
  request_count_sla: number;
  token_consumed: number;
  sla: number;
  error_rate: number;
  upstream_error_rate: number;
  upstream_error_count_excl_429_529: number;
  upstream_429_count: number;
  upstream_529_count: number;
  qps: OpsRateSummary;
  tps: OpsRateSummary;
  duration: OpsPercentiles;
  ttft: OpsPercentiles;
};

export type OpsConcurrencyInfo = {
  platform: string;
  current_in_use: number;
  max_capacity: number;
  load_percentage: number;
  waiting_in_queue: number;
};

export type OpsGroupConcurrencyInfo = {
  group_id: number;
  group_name: string;
  platform: string;
  current_in_use: number;
  max_capacity: number;
  load_percentage: number;
  waiting_in_queue: number;
};

export type OpsActiveModelConcurrencyInfo = {
  model: string;
  current_in_use: number;
};

export type OpsAccountConcurrencyInfo = {
  account_id: number;
  account_name?: string;
  platform: string;
  group_id: number;
  group_name: string;
  current_in_use: number;
  max_capacity: number;
  load_percentage: number;
  waiting_in_queue: number;
  active_models?: OpsActiveModelConcurrencyInfo[];
  unattributed_in_use?: number;
};

export type OpsConcurrencyStats = {
  enabled: boolean;
  platform: Record<string, OpsConcurrencyInfo>;
  group: Record<string, OpsGroupConcurrencyInfo>;
  account: Record<string, OpsAccountConcurrencyInfo>;
  timestamp?: string;
};

export type OverloadCooldownSettings = {
  enabled: boolean;
  cooldown_minutes: number;
};

export type RateLimit429CooldownSettings = {
  enabled: boolean;
  cooldown_seconds: number;
};

export type StreamTimeoutAction = 'temp_unsched' | 'error' | 'none';

export type StreamTimeoutSettings = {
  enabled: boolean;
  action: StreamTimeoutAction;
  temp_unsched_minutes: number;
  threshold_count: number;
  threshold_window_minutes: number;
};

export type AdminSettings = {
  site_name?: string;
  registration_enabled: boolean;
  email_verify_enabled: boolean;
  password_reset_enabled: boolean;
  default_concurrency: number;
  channel_monitor_enabled: boolean;
  model_plaza_enabled?: boolean;
  model_plaza_require_auth?: boolean;
  model_plaza_description?: string;
  [key: string]: string | number | boolean | null | string[] | undefined;
};

export type AdminSettingsUpdate = Partial<Pick<
  AdminSettings,
  | 'registration_enabled'
  | 'email_verify_enabled'
  | 'password_reset_enabled'
  | 'default_concurrency'
  | 'channel_monitor_enabled'
  | 'model_plaza_enabled'
  | 'model_plaza_require_auth'
  | 'model_plaza_description'
>>;

export type AdminUser = {
  id: number;
  email: string;
  username?: string | null;
  balance?: number;
  concurrency?: number;
  status?: string;
  role?: string;
  current_concurrency?: number;
  notes?: string | null;
  last_used_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type UserUsageSummary = {
  total_requests?: number;
  total_tokens?: number;
  total_cost?: number;
  requests?: number;
  tokens?: number;
  cost?: number;
  [key: string]: string | number | boolean | null | undefined;
};

export type AdminApiKey = {
  id: number;
  user_id: number;
  key: string;
  name: string;
  group_id?: number | null;
  status: string;
  quota: number;
  quota_used: number;
  last_used_at?: string | null;
  expires_at?: string | null;
  created_at?: string;
  updated_at?: string;
  usage_5h?: number;
  usage_1d?: number;
  usage_7d?: number;
  group?: AdminGroup;
  user?: {
    id: number;
    email?: string;
    username?: string | null;
  };
};

export type BalanceOperation = 'set' | 'add' | 'subtract';

export type AdminGroup = {
  id: number;
  name: string;
  description?: string | null;
  platform: string;
  rate_multiplier?: number;
  is_exclusive?: boolean;
  status?: string;
  subscription_type?: string;
  daily_limit_usd?: number | null;
  weekly_limit_usd?: number | null;
  monthly_limit_usd?: number | null;
  account_count?: number;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
};

export type GroupCapacitySummary = {
  group_id: number;
  concurrency_used: number;
  concurrency_max: number;
  sessions_used: number;
  sessions_max: number;
  rpm_used: number;
  rpm_max: number;
};

export type AccountTodayStats = {
  requests: number;
  tokens: number;
  cost: number;
  standard_cost?: number;
  user_cost?: number;
  recent_first_token_ms?: Array<number | null>;
};

export type AccountTodayStatsBatchResponse = {
  stats: Record<string, AccountTodayStats>;
  first_token_stats_error?: string;
};

export type UpstreamBillingProbeSnapshot = {
  status: 'ok' | 'unsupported' | 'failed' | string;
  data?: Record<string, unknown>;
  received_at?: string;
  fresh_until?: string;
  last_attempt_at?: string;
  next_probe_at?: string;
  failure_count?: number;
  http_status?: number;
  last_error?: string;
};

export type UpstreamBillingProbeResult = {
  account_id: number;
  snapshot?: UpstreamBillingProbeSnapshot;
  error?: string;
};

export type UpstreamBillingCostRateSegment = {
  rate_multiplier: number;
  token_request_count: number;
  standard_cost: number;
  estimated_upstream_cost: number;
};

export type UpstreamBillingCostEstimate = {
  standard_cost: number;
  covered_standard_cost?: number;
  uncovered_standard_cost?: number;
  effective_rate_multiplier?: number;
  estimated_upstream_cost?: number;
  token_request_count?: number;
  covered_token_request_count?: number;
  uncovered_token_request_count?: number;
  non_token_request_count?: number;
  unknown_billing_mode_request_count?: number;
  live_rate_request_count?: number;
  cached_rate_request_count?: number;
  rate_segments?: UpstreamBillingCostRateSegment[];
  models?: UpstreamBillingCostModelEstimate[];
  status: 'estimated' | 'partial' | 'cached' | 'unavailable' | string;
  reason?: string;
  rate_observed_at?: string;
};

export type UpstreamBillingCostModelEstimate = {
  model: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  standard_cost: number;
  covered_standard_cost?: number;
  uncovered_standard_cost?: number;
  effective_rate_multiplier?: number;
  estimated_upstream_cost?: number;
  token_request_count?: number;
  covered_token_request_count?: number;
  uncovered_token_request_count?: number;
  non_token_request_count?: number;
  unknown_billing_mode_request_count?: number;
  live_rate_request_count?: number;
  cached_rate_request_count?: number;
  rate_segments?: UpstreamBillingCostRateSegment[];
  status: 'estimated' | 'partial' | 'cached' | 'unavailable' | string;
  reason?: string;
}

export type UpstreamBillingCost24hResponse = {
  window_start: string;
  window_end: string;
  timezone: string;
  costs: Record<string, UpstreamBillingCostEstimate>;
};

export type AdminAccount = {
  id: number;
  name: string;
  notes?: string | null;
  platform: string;
  type: string;
  status?: string;
  schedulable?: boolean;
  priority?: number;
  concurrency?: number;
  current_concurrency?: number;
  load_factor?: number | null;
  rate_multiplier?: number;
  error_message?: string;
  rate_limited_at?: string | null;
  rate_limit_reset_at?: string | null;
  overload_until?: string | null;
  temp_unschedulable_until?: string | null;
  temp_unschedulable_reason?: string | null;
  expires_at?: number | string | null;
  auto_pause_on_expired?: boolean;
  session_window_start?: string | null;
  session_window_end?: string | null;
  session_window_status?: string | null;
  window_cost_limit?: number | null;
  window_cost_sticky_reserve?: number | null;
  current_window_cost?: number | null;
  max_sessions?: number | null;
  active_sessions?: number | null;
  session_idle_timeout_minutes?: number | null;
  base_rpm?: number | null;
  current_rpm?: number | null;
  rpm_strategy?: string | null;
  rpm_sticky_buffer?: number | null;
  quota_limit?: number | null;
  quota_used?: number | null;
  quota_daily_limit?: number | null;
  quota_daily_used?: number | null;
  quota_weekly_limit?: number | null;
  quota_weekly_used?: number | null;
  quota_daily_reset_at?: string | null;
  quota_weekly_reset_at?: string | null;
  updated_at?: string;
  last_used_at?: string | null;
  group_ids?: number[];
  groups?: AdminGroup[];
  extra?: Record<string, unknown>;
};

export type AccountType = 'apikey' | 'oauth' | 'setup-token' | 'upstream';

export type CreateAccountRequest = {
  name: string;
  platform: string;
  type: AccountType;
  credentials: Record<string, string | number | boolean | null | undefined>;
  extra?: Record<string, string | number | boolean | null | undefined>;
  notes?: string;
  proxy_id?: number;
  concurrency?: number;
  priority?: number;
  rate_multiplier?: number;
  group_ids?: number[];
  upstream_billing_probe_enabled?: boolean;
};

export type CreateUserRequest = {
  email: string;
  password: string;
  username?: string;
  notes?: string;
  role?: 'user' | 'admin';
  status?: 'active' | 'disabled';
  balance?: number;
  concurrency?: number;
  [key: string]: string | number | boolean | null | undefined;
};
