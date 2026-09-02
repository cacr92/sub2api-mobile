import type { AdminAccount } from '@/src/types/admin';

export type AccountRecoveryReasonKind =
  | 'error'
  | 'rate_limit'
  | 'model_rate_limit'
  | 'overload'
  | 'temp_unschedulable'
  | 'quota_scope';

export type AccountRecoveryReason = {
  kind: AccountRecoveryReasonKind;
  label: string;
  detail: string;
  severity: 'danger' | 'warning';
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFutureTimestamp(value: unknown, now: number) {
  if (typeof value !== 'string' || !value) return null;
  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) && timestamp > now ? timestamp : null;
}

function formatUntil(timestamp: number, now: number) {
  const value = new Date(timestamp);
  const nowValue = new Date(now);
  const sameDay = value.getFullYear() === nowValue.getFullYear()
    && value.getMonth() === nowValue.getMonth()
    && value.getDate() === nowValue.getDate();
  const time = `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;

  return sameDay ? `今日 ${time}` : `${value.getMonth() + 1} 月 ${value.getDate()} 日 ${time}`;
}

function getActiveModelRateLimits(extra: Record<string, unknown> | undefined, now: number) {
  const modelRateLimits = extra?.model_rate_limits;
  if (!isRecord(modelRateLimits)) return [];

  return Object.entries(modelRateLimits).filter(([, value]) => {
    if (!isRecord(value)) return true;
    const resetAt = value.rate_limit_reset_at;

    return typeof resetAt !== 'string' || parseFutureTimestamp(resetAt, now) !== null;
  });
}

export function getAccountRecoveryReasons(account: AdminAccount, now = Date.now()): AccountRecoveryReason[] {
  const reasons: AccountRecoveryReason[] = [];

  if (`${account.status ?? ''}`.toLowerCase() === 'error') {
    reasons.push({
      kind: 'error',
      label: '账号错误',
      detail: account.error_message?.trim() || '服务端已将此账号标记为错误',
      severity: 'danger',
    });
  }

  const rateLimitResetAt = parseFutureTimestamp(account.rate_limit_reset_at, now);
  if (rateLimitResetAt !== null) {
    reasons.push({
      kind: 'rate_limit',
      label: '上游限流',
      detail: `预计 ${formatUntil(rateLimitResetAt, now)} 恢复`,
      severity: 'warning',
    });
  } else if (account.rate_limited_at && !account.rate_limit_reset_at) {
    reasons.push({
      kind: 'rate_limit',
      label: '上游限流',
      detail: '服务端未返回自动恢复时间',
      severity: 'warning',
    });
  }

  const modelRateLimits = getActiveModelRateLimits(account.extra, now);
  if (modelRateLimits.length > 0) {
    const modelNames = modelRateLimits.map(([model]) => model).slice(0, 2);
    const suffix = modelRateLimits.length > modelNames.length ? ` 等 ${modelRateLimits.length} 个模型` : '';
    reasons.push({
      kind: 'model_rate_limit',
      label: '模型限流',
      detail: `${modelNames.join('、')}${suffix}`,
      severity: 'warning',
    });
  }

  const overloadUntil = parseFutureTimestamp(account.overload_until, now);
  if (overloadUntil !== null) {
    reasons.push({
      kind: 'overload',
      label: '上游过载',
      detail: `预计 ${formatUntil(overloadUntil, now)} 恢复`,
      severity: 'warning',
    });
  }

  const tempUnschedulableUntil = parseFutureTimestamp(account.temp_unschedulable_until, now);
  if (tempUnschedulableUntil !== null) {
    reasons.push({
      kind: 'temp_unschedulable',
      label: '临时不可调度',
      detail: account.temp_unschedulable_reason?.trim() || `预计 ${formatUntil(tempUnschedulableUntil, now)} 恢复`,
      severity: 'warning',
    });
  }

  const quotaScopes = account.extra?.antigravity_quota_scopes;
  if ((isRecord(quotaScopes) && Object.keys(quotaScopes).length > 0) || (Array.isArray(quotaScopes) && quotaScopes.length > 0)) {
    reasons.push({
      kind: 'quota_scope',
      label: '上游配额受限',
      detail: '存在可清理的上游配额限制',
      severity: 'warning',
    });
  }

  return reasons;
}

export function getAccountRecoverySummary(account: AdminAccount, now = Date.now()) {
  const reasons = getAccountRecoveryReasons(account, now);
  const primary = reasons.find((reason) => reason.severity === 'danger') ?? reasons[0];

  return {
    recoverable: reasons.length > 0,
    reasons,
    label: primary?.label ?? '状态正常',
    detail: reasons.map((reason) => `${reason.label}：${reason.detail}`).join('；'),
    severity: primary?.severity ?? 'warning',
  };
}
