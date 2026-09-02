import type { AdminAccount, UpstreamBillingCostEstimate, UpstreamBillingCostModelEstimate } from '@/src/types/admin';

export type UpstreamBillingRateDisplay = {
  value: string;
  detail?: string;
  detailTone?: 'muted' | 'warning';
};

export type UpstreamBillingCostDisplay = {
  value: string;
  detail?: string;
  detailTone?: 'muted' | 'warning';
};

const UPSTREAM_BILLING_CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getFiniteNonNegativeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function getFiniteNonNegativeInteger(value: unknown) {
  const numberValue = getFiniteNonNegativeNumber(value);
  return numberValue !== null && Number.isInteger(numberValue) ? numberValue : null;
}

function formatUpstreamBillingCost(value: number) {
  const normalizedValue = Object.is(value, -0) ? 0 : value;
  const digits = Math.abs(normalizedValue) > 0 && Math.abs(normalizedValue) < 0.01 ? 4 : 2;

  return `$${normalizedValue.toFixed(digits)}`;
}

function parseTimestamp(value: unknown) {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : null;
}

export function isUpstreamBillingProbeEligible(account: AdminAccount) {
  const platform = account.platform.toLowerCase();
  return (platform === 'anthropic' || platform === 'openai' || platform === 'grok') && account.type.toLowerCase() === 'apikey';
}

function getFreshUntil(snapshot: Record<string, unknown>, receivedAt: number) {
  if (typeof snapshot.fresh_until === 'string') return parseTimestamp(snapshot.fresh_until);
  if (snapshot.status !== 'ok') return null;

  const nextProbeAt = parseTimestamp(snapshot.next_probe_at);
  return nextProbeAt !== null && nextProbeAt > receivedAt ? receivedAt + 2 * (nextProbeAt - receivedAt) : null;
}

function parseClockMinute(value: unknown) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
}

function getMinuteInTimeZone(timestamp: number, timeZone: unknown) {
  if (typeof timeZone !== 'string' || !timeZone) return null;

  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(timestamp));
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value);

    return Number.isInteger(hour) && Number.isInteger(minute) ? hour * 60 + minute : null;
  } catch {
    return null;
  }
}

function getFreshUpstreamBillingData(account: AdminAccount, now: number): Record<string, unknown> | null {
  if (!isUpstreamBillingProbeEligible(account)) return null;

  const snapshot = account.extra?.upstream_billing_probe;
  if (!isRecord(snapshot) || (snapshot.status !== 'ok' && snapshot.status !== 'failed')) return null;

  const billing = snapshot.data;
  if (!isRecord(billing) || billing.billing_scope !== 'token') return null;

  const receivedAt = parseTimestamp(snapshot.received_at);
  const freshUntil = receivedAt === null ? null : getFreshUntil(snapshot, receivedAt);
  if (
    receivedAt === null
    || freshUntil === null
    || receivedAt > now + UPSTREAM_BILLING_CLOCK_SKEW_TOLERANCE_MS
    || freshUntil <= receivedAt
    || now > freshUntil
  ) {
    return null;
  }

  return billing;
}

function getUpstreamBillingRate(account: AdminAccount, now: number) {
  const billing = getFreshUpstreamBillingData(account, now);
  if (!billing) return '--';

  const base = getFiniteNonNegativeNumber(billing.resolved_rate_multiplier);
  if (base === null || typeof billing.peak_rate_enabled !== 'boolean') return '--';

  let rate = base;
  if (billing.peak_rate_enabled) {
    const start = parseClockMinute(billing.peak_start);
    const end = parseClockMinute(billing.peak_end);
    const minute = getMinuteInTimeZone(now, billing.timezone);
    const peak = getFiniteNonNegativeNumber(billing.peak_rate_multiplier);
    if (start === null || end === null || minute === null || start >= end || peak === null) return '--';
    if (minute >= start && minute < end) rate *= peak;
  }

  return Number.isFinite(rate) ? `${Number(rate.toPrecision(12))}x` : '--';
}

export function getUpstreamBillingRateDisplay(account: AdminAccount, now = Date.now()): UpstreamBillingRateDisplay {
  if (!isUpstreamBillingProbeEligible(account)) {
    return { value: '不支持', detail: '此账号暂不支持上游倍率查询', detailTone: 'warning' };
  }

  const rate = getUpstreamBillingRate(account, now);
  const snapshot = account.extra?.upstream_billing_probe;

  if (rate !== '--') {
    const isCachedAfterFailure = isRecord(snapshot) && snapshot.status === 'failed';
    return {
      value: rate,
      detail: isCachedAfterFailure ? '倍率探测失败，暂用有效缓存' : undefined,
      detailTone: isCachedAfterFailure ? 'warning' : undefined,
    };
  }

  if (!isRecord(snapshot)) {
    return account.extra?.upstream_billing_probe_enabled === true
      ? { value: '待探测', detail: '尚未获取上游倍率', detailTone: 'muted' }
      : { value: '未启用', detail: '未启用上游倍率探测', detailTone: 'warning' };
  }

  if (snapshot.status === 'unsupported') {
    return { value: '不支持', detail: '上游不支持倍率查询', detailTone: 'warning' };
  }
  if (snapshot.status === 'failed') {
    return { value: '探测失败', detail: '最近一次上游倍率探测失败', detailTone: 'warning' };
  }

  return { value: '已过期', detail: '上游倍率快照已过期或格式无效', detailTone: 'warning' };
}

export function getUpstreamBillingCostDisplay(
  estimate?: UpstreamBillingCostEstimate | UpstreamBillingCostModelEstimate,
  error?: unknown
): UpstreamBillingCostDisplay {
  const amount = getFiniteNonNegativeNumber(estimate?.estimated_upstream_cost);
  const tokenRequestCount = getFiniteNonNegativeInteger(estimate?.token_request_count);
  const coveredTokenRequestCount = getFiniteNonNegativeInteger(estimate?.covered_token_request_count);
  const uncoveredTokenRequestCount = getFiniteNonNegativeInteger(estimate?.uncovered_token_request_count);

  if (amount !== null) {
    if (tokenRequestCount === null || coveredTokenRequestCount === null) {
      return {
        value: formatUpstreamBillingCost(amount),
        detail: '服务器返回旧版估算，金额可能不完整',
        detailTone: 'warning',
      };
    }

    if (estimate?.status === 'partial' || (uncoveredTokenRequestCount ?? 0) > 0) {
      return {
        value: formatUpstreamBillingCost(amount),
        detail: '部分历史请求缺少倍率，金额仅统计已覆盖部分',
        detailTone: 'warning',
      };
    }

    return { value: formatUpstreamBillingCost(amount) };
  }

  switch (estimate?.reason) {
    case 'no_token_usage':
      return { value: '$0.00' };
    case 'missing_request_rate_snapshot':
      return { value: '--', detail: '历史请求缺少倍率，无法计算上游费用', detailTone: 'warning' };
    case 'account_not_eligible':
      return { value: '不支持', detail: '此账号暂不支持上游费用计算', detailTone: 'warning' };
    case 'missing_snapshot':
      return { value: '待快照', detail: '等待上游倍率快照', detailTone: 'muted' };
    case 'upstream_unsupported':
      return { value: '不支持', detail: '上游不支持倍率查询', detailTone: 'warning' };
    case 'probe_failed':
      return { value: '探测失败', detail: '倍率快照刷新失败', detailTone: 'warning' };
    case 'stale_snapshot':
      return { value: '已过期', detail: '倍率快照已过期', detailTone: 'warning' };
    case 'invalid_usage_stats':
    case 'invalid_estimate':
      return { value: '--', detail: '上游费用数据异常', detailTone: 'warning' };
    default:
      if (error instanceof Error && (error.message === 'HTTP_404' || error.message === 'INVALID_SERVER_RESPONSE')) {
        return { value: '未部署', detail: '当前服务器尚未部署今日费用估算', detailTone: 'warning' };
      }
      return { value: '--', detail: '暂无可用的请求时上游倍率', detailTone: 'muted' };
  }
}
