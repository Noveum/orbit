export const readinessReferenceRegistry = {
  records: new Map([
    ['record:audit/f1bfdc3', 'https://github.com/Noveum/orbit/commit/f1bfdc3'],
    ['record:audit/9f961a1', 'https://github.com/Noveum/orbit/commit/9f961a1'],
  ]),
  principals: new Map([
    [
      'principal:security-owner',
      {
        link: 'https://github.com/Noveum/orbit/blob/main/docs/maintainers/readiness-ledger.md',
        role: 'Security maintainer',
      },
    ],
    [
      'principal:data-owner',
      {
        link: 'https://github.com/Noveum/orbit/blob/main/docs/maintainers/readiness-ledger.md',
        role: 'Data maintainer',
      },
    ],
    [
      'principal:platform-owner',
      {
        link: 'https://github.com/Noveum/orbit/blob/main/docs/maintainers/readiness-ledger.md',
        role: 'Platform maintainer',
      },
    ],
    [
      'principal:realtime-owner',
      {
        link: 'https://github.com/Noveum/orbit/blob/main/docs/maintainers/readiness-ledger.md',
        role: 'Realtime maintainer',
      },
    ],
    [
      'principal:integrations-owner',
      {
        link: 'https://github.com/Noveum/orbit/blob/main/docs/maintainers/readiness-ledger.md',
        role: 'Integrations maintainer',
      },
    ],
    [
      'principal:release-owner',
      {
        link: 'https://github.com/Noveum/orbit/blob/main/docs/maintainers/readiness-ledger.md',
        role: 'Release maintainer',
      },
    ],
    [
      'principal:documentation-owner',
      {
        link: 'https://github.com/Noveum/orbit/blob/main/docs/maintainers/readiness-ledger.md',
        role: 'Documentation maintainer',
      },
    ],
    [
      'principal:repository-owner',
      {
        link: 'https://github.com/Noveum/orbit/blob/main/docs/maintainers/readiness-ledger.md',
        role: 'Repository maintainer',
      },
    ],
  ]),
} as const;
