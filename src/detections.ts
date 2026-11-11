import type { OrganizationDetail } from './analytics.ts';

export type DetectionSource = 'authentication' | 'provisioning';

export interface AgentDetection {
  timestamp: string;
  organizationId: string;
  agentId: string;
  source: DetectionSource;
}

interface IdentitySets {
  agents: Set<string>;
  authentication: Set<string>;
  provisioning: Set<string>;
}

export interface TenantDetectionCounts {
  rows: {
    tenantId: string; tenantName?: string; organizations: number;
    agents: number; authentication: number; provisioning: number;
  }[];
  unmapped: { organizations: number; agents: number; authentication: number; provisioning: number };
}

const emptySets = (): IdentitySets => ({ agents: new Set(), authentication: new Set(), provisioning: new Set() });
const sizes = (sets: IdentitySets) => ({
  agents: sets.agents.size, authentication: sets.authentication.size, provisioning: sets.provisioning.size,
});

function detectionGroups(events: AgentDetection[], startTime: string, endTime: string) {
  const start = Date.parse(startTime), end = Date.parse(endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw new Error('Expected an ordered, valid detection time window.');
  }
  const organizations = new Map<string, IdentitySets>();
  for (const event of events) {
    const timestamp = Date.parse(event.timestamp);
    if (!Number.isFinite(timestamp)) throw new Error('Invalid detection timestamp.');
    if (event.source !== 'authentication' && event.source !== 'provisioning') {
      throw new Error('Unknown detection source.');
    }
    if (timestamp < start || timestamp >= end) continue;
    const organizationId = event.organizationId.trim().toLowerCase();
    const agentId = event.agentId.trim().toLowerCase();
    if (!organizationId || !agentId) continue;
    let organization = organizations.get(organizationId);
    if (!organization) {
      organization = emptySets();
      organizations.set(organizationId, organization);
    }
    organization.agents.add(agentId);
    organization[event.source].add(agentId);
  }
  return organizations;
}

export function aggregateDetections(events: AgentDetection[], startTime: string, endTime: string) {
  const organizations = detectionGroups(events, startTime, endTime);
  const agents = new Set<string>();
  const rows = Array.from(organizations, ([organizationId, counts]) => {
    for (const agent of counts.agents) agents.add(agent);
    return { organizationId, ...sizes(counts) };
  }).sort((a, b) => b.agents - a.agents || a.organizationId.localeCompare(b.organizationId));
  return {
    startTime, endTime, rows,
    totals: {
      agents: agents.size,
      organizations: rows.length,
      authenticationPairs: rows.reduce((sum, row) => sum + row.authentication, 0),
      provisioningPairs: rows.reduce((sum, row) => sum + row.provisioning, 0),
    },
  };
}

export function aggregateTenantDetections(
  events: AgentDetection[], organizationDetails: OrganizationDetail[], startTime: string, endTime: string,
): TenantDetectionCounts {
  const mapping = new Map<string, string>();
  for (const detail of organizationDetails) {
    const organizationId = detail.organizationId.trim().toLowerCase();
    const tenantId = detail.tenantId?.trim().toLowerCase();
    if (!organizationId) throw new Error('Organization mapping requires an organization ID.');
    if (!tenantId || tenantId === '00000000-0000-0000-0000-000000000000') continue;
    if (mapping.has(organizationId) && mapping.get(organizationId) !== tenantId) {
      throw new Error(`Conflicting tenant mapping for ${organizationId}.`);
    }
    mapping.set(organizationId, tenantId);
  }
  const tenants = new Map<string, IdentitySets & { organizations: number }>();
  const unmapped = { ...emptySets(), organizations: 0 };
  for (const [organizationId, identities] of detectionGroups(events, startTime, endTime)) {
    const tenantId = mapping.get(organizationId);
    const target = tenantId ? tenants.get(tenantId) ?? { ...emptySets(), organizations: 0 } : unmapped;
    if (tenantId) tenants.set(tenantId, target);
    target.organizations++;
    for (const key of ['agents', 'authentication', 'provisioning'] as const) {
      for (const agent of identities[key]) target[key].add(agent);
    }
  }
  return {
    rows: Array.from(tenants, ([tenantId, sets]) => ({ tenantId, organizations: sets.organizations, ...sizes(sets) }))
      .sort((a, b) => b.agents - a.agents || a.tenantId.localeCompare(b.tenantId)),
    unmapped: { organizations: unmapped.organizations, ...sizes(unmapped) },
  };
}
