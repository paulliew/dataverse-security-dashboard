import { daysBefore, utcDay } from './analytics.ts';
import type { OrganizationDetail, TraceEvent } from './analytics.ts';
import type { AgentDetection } from './detections.ts';

export interface SampleDataset {
  mode: 'synthetic';
  asOf: string;
  historyStart: string;
  events: TraceEvent[];
  organizationDetails: OrganizationDetail[];
  detections: AgentDetection[];
  detectionEndTime: string;
}

// Replace this provider, not the presentation layer, when a live adapter is approved.
export function loadSampleData(now = new Date()): SampleDataset {
  const asOf = utcDay(now);
  const events: TraceEvent[] = [];
  const organizationDetails = Array.from({ length: 24 }, (_, index) => ({
    organizationId: `sample-org-${index + 1}`,
    tenantId: index === 23 ? null : `sample-tenant-${Math.floor(index / 3) + 1}`,
  }));
  for (let offset = 120; offset >= 0; offset--) {
    const day = daysBefore(asOf, offset);
    const progress = Math.max(0, 90 - offset);
    const organizationCount = Math.min(24, 6 + Math.floor((120 - offset) / 6));
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    const count = progress === 18 || progress === 47 ? 0
      : Math.round((9 + progress * 0.55 + Math.sin(progress * 0.6) * 9) * (weekday === 0 || weekday === 6 ? 0.45 : 1));
    for (let index = 0; index < count; index++) {
      const correlationId = `sample-${day}-${index}`;
      const organizationId = `sample-org-${(index * 7 + progress) % organizationCount + 1}`;
      const userObjectId = `sample-user-${day}-${index}`;
      const createdAt = `${day}T${String(1 + index % 18).padStart(2, '0')}:04:00Z`;
      events.push(
        { correlationId, timestamp: `${day}T00:01:00Z`, kind: index % 2 ? 'applyUser' : 'forceSync' },
        { correlationId, timestamp: `${day}T00:02:00Z`, kind: 'agentIdentified', userObjectId, organizationId },
        { correlationId, timestamp: createdAt, kind: 'userCreated' },
      );
    }
  }
  // A creation today with detection yesterday exercises the midnight boundary.
  events.push(
    { correlationId: 'sample-midnight', timestamp: `${daysBefore(asOf, 1)}T23:59:00Z`, kind: 'agentIdentified', userObjectId: 'sample-midnight-user', organizationId: 'sample-org-1' },
    { correlationId: 'sample-midnight', timestamp: `${daysBefore(asOf, 1)}T23:59:30Z`, kind: 'applyUser' },
    { correlationId: 'sample-midnight', timestamp: `${asOf}T00:00:10Z`, kind: 'userCreated' },
  );
  const detectionEndTime = now.toISOString();
  const detections: AgentDetection[] = [];
  for (let org = 1; org <= 12; org++) {
    for (let agent = 0; agent < 2 + org % 5; agent++) {
      const base = {
        timestamp: new Date(now.getTime() - (1 + agent) * 3_600_000).toISOString(),
        organizationId: `sample-org-${org}`,
        agentId: `sample-detected-agent-${agent}`,
      };
      detections.push({ ...base, source: 'authentication' });
      if (agent % 2 === 0) detections.push({ ...base, source: 'provisioning' });
      detections.push({ ...base, source: 'authentication' });
    }
  }
  return { mode: 'synthetic', asOf, historyStart: daysBefore(asOf, 120), events, organizationDetails, detections, detectionEndTime };
}
