export type EventKind = 'agentIdentified' | 'applyUser' | 'forceSync' | 'userCreated';

export interface TraceEvent {
  correlationId: string;
  timestamp: string;
  kind: EventKind;
  userObjectId?: string;
  organizationId?: string;
}

export interface OrganizationDetail {
  organizationId: string;
  tenantId: string | null;
}

export interface Creation {
  correlationId: string;
  timestamp: string;
  userObjectId: string;
  organizationId: string;
}

export interface DailyMetric {
  day: string;
  users: number;
  organizations: number;
  tenants: number;
}

export interface DashboardData {
  daily: DailyMetric[];
  totals: { users: number; organizations: number; tenants: number; unmappedOrganizations: number };
}

export function utcDay(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid date.');
  return date.toISOString().slice(0, 10);
}

export function daysBefore(day: string, count: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - count);
  return utcDay(date);
}

// Correlate the complete input before applying the creation-time range.
export function correlateCreations(events: TraceEvent[]): Creation[] {
  const groups = new Map<string, TraceEvent[]>();
  for (const event of events) {
    if (!event.correlationId.trim()) continue;
    const group = groups.get(event.correlationId);
    if (group) group.push(event);
    else groups.set(event.correlationId, [event]);
  }
  const creations: Creation[] = [];
  for (const [correlationId, traces] of groups) {
    for (const trace of traces) {
      if (!Number.isFinite(Date.parse(trace.timestamp))) throw new Error(`Invalid timestamp in ${correlationId}.`);
    }
    const identified = traces.filter(trace => trace.kind === 'agentIdentified' && trace.userObjectId && trace.organizationId);
    const users = new Set(identified.map(trace => trace.userObjectId!));
    const organizations = new Set(identified.map(trace => trace.organizationId!));
    if (users.size > 1 || organizations.size > 1) throw new Error(`Ambiguous identity in correlation ${correlationId}.`);
    const created = traces.filter(trace => trace.kind === 'userCreated')
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))[0];
    if (!created || users.size !== 1 || !traces.some(trace => trace.kind === 'applyUser' || trace.kind === 'forceSync')) continue;
    creations.push({
      correlationId,
      timestamp: created.timestamp,
      userObjectId: identified[0].userObjectId!,
      organizationId: identified[0].organizationId!,
    });
  }
  return creations;
}

export function aggregateDaily(
  creations: Creation[],
  organizationDetails: OrganizationDetail[],
  start: string,
  end: string,
): DashboardData {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(start) || !datePattern.test(end) || start > end
    || utcDay(new Date(`${start}T00:00:00Z`)) !== start || utcDay(new Date(`${end}T00:00:00Z`)) !== end) {
    throw new Error('Expected an ordered, valid UTC date range.');
  }
  const tenantByOrganization = new Map<string, string>();
  for (const detail of organizationDetails) {
    if (!detail.organizationId.trim()) throw new Error('Organization mapping requires an organization ID.');
    if (!detail.tenantId?.trim()) continue;
    const previous = tenantByOrganization.get(detail.organizationId);
    if (previous && previous !== detail.tenantId) throw new Error(`Conflicting tenant mapping for ${detail.organizationId}.`);
    tenantByOrganization.set(detail.organizationId, detail.tenantId);
  }
  const buckets = new Map<string, { users: Set<string>; organizations: Set<string>; tenants: Set<string> }>();
  for (let day = start; day <= end; day = daysBefore(day, -1)) {
    buckets.set(day, { users: new Set(), organizations: new Set(), tenants: new Set() });
  }
  const users = new Set<string>();
  const organizations = new Set<string>();
  const tenants = new Set<string>();
  const unmappedOrganizations = new Set<string>();
  for (const creation of creations) {
    const bucket = buckets.get(utcDay(new Date(creation.timestamp)));
    if (!bucket) continue;
    users.add(creation.userObjectId);
    organizations.add(creation.organizationId);
    bucket.users.add(creation.userObjectId);
    bucket.organizations.add(creation.organizationId);
    const tenant = tenantByOrganization.get(creation.organizationId);
    if (tenant) {
      tenants.add(tenant);
      bucket.tenants.add(tenant);
    } else {
      unmappedOrganizations.add(creation.organizationId);
    }
  }
  return {
    daily: Array.from(buckets, ([day, bucket]) => ({
      day, users: bucket.users.size, organizations: bucket.organizations.size, tenants: bucket.tenants.size,
    })),
    totals: { users: users.size, organizations: organizations.size, tenants: tenants.size, unmappedOrganizations: unmappedOrganizations.size },
  };
}
