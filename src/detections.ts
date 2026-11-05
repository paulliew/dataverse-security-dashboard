export type DetectionSource = 'authentication' | 'provisioning';

export interface AgentDetection {
  timestamp: string;
  organizationId: string;
  agentId: string;
  source: DetectionSource;
}

export function aggregateDetections(events: AgentDetection[], startTime: string, endTime: string) {
  const start = Date.parse(startTime), end = Date.parse(endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw new Error('Expected an ordered, valid detection time window.');
  }
  const organizations = new Map<string, {
    agents: Set<string>; authentication: Set<string>; provisioning: Set<string>;
  }>();
  const agents = new Set<string>();
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
      organization = { agents: new Set(), authentication: new Set(), provisioning: new Set() };
      organizations.set(organizationId, organization);
    }
    agents.add(agentId);
    organization.agents.add(agentId);
    organization[event.source].add(agentId);
  }
  const rows = Array.from(organizations, ([organizationId, counts]) => ({
    organizationId,
    agents: counts.agents.size,
    authentication: counts.authentication.size,
    provisioning: counts.provisioning.size,
  })).sort((a, b) => b.agents - a.agents || a.organizationId.localeCompare(b.organizationId));
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
