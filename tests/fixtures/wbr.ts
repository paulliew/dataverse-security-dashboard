// Synthetic test values only; not measured production telemetry.
export const wbrFixture = () => ({
  version: 1, dataMode: 'production', coverage: 'configured-source-groups',
  observationStart: '2026-10-01T00:00:00Z', asOf: '2026-11-11T12:00:00Z',
  identityCountMethod: 'exact-distinct-identities', callCountMethod: 'distinct-request-ids',
  callScope: 'detected-cohort-nonbatch-success',
  baseline: { endTime: '2026-10-19T00:00:00Z', identities: { status: 'verified', value: 10 } },
  weeks: [
    { startTime: '2026-10-19T00:00:00Z', endTime: '2026-10-26T00:00:00Z',
      identities: { status: 'verified', value: 20 },
      calls: { status: 'verified', value: 12, missingRequestIds: 0, conflictingRequestIds: 0 } },
    { startTime: '2026-10-26T00:00:00Z', endTime: '2026-11-02T00:00:00Z',
      identities: { status: 'verified', value: 30 },
      calls: { status: 'verified', value: 25, missingRequestIds: 0, conflictingRequestIds: 0 } },
    { startTime: '2026-11-02T00:00:00Z', endTime: '2026-11-09T00:00:00Z',
      identities: { status: 'verified', value: 30 },
      calls: { status: 'verified', value: 0, missingRequestIds: 0, conflictingRequestIds: 0 } },
  ],
});
