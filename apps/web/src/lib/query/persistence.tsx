'use client';

import { persistQueryClient } from '@tanstack/query-persist-client-core';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import {
  CACHE_MAX_AGE_MS,
  cacheBuster,
  createCachePersister,
  shouldPersistQuery,
} from './persist.ts';

interface WorkspaceCachePersistenceProps {
  readonly userId: string;
  readonly organizationId: string;
}

export function WorkspaceCachePersistence({
  userId,
  organizationId,
}: WorkspaceCachePersistenceProps) {
  const client = useQueryClient();

  useEffect(() => {
    const [unsubscribe] = persistQueryClient({
      queryClient: client,
      persister: createCachePersister(),
      maxAge: CACHE_MAX_AGE_MS,
      buster: cacheBuster(userId, organizationId),
      dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
    });
    return unsubscribe;
  }, [client, userId, organizationId]);

  return null;
}
