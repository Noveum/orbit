import { AsyncLocalStorage } from 'node:async_hooks';
import { retryInitialDatabaseConnection } from '@orbit/db';
import type { DBAdapterInstance } from 'better-auth';

export function withOAuthResourceConnectionRetry(
  factory: DBAdapterInstance,
  resourceIdentifier: string,
): DBAdapterInstance {
  return (options) => {
    const adapter = factory(options);
    const provider = options.plugins?.find((plugin) => plugin.id === 'oauth-provider');
    const resourceModel =
      provider?.schema?.['oauthResource']?.modelName ??
      (provider === undefined ? undefined : 'oauthResource');
    const transactionScope = new AsyncLocalStorage<boolean>();
    const findOne = adapter.findOne.bind(adapter);
    const transaction = adapter.transaction.bind(adapter);
    adapter.findOne = <T>(query: Parameters<typeof findOne>[0]): Promise<T | null> => {
      const condition = query.where[0];
      const isResourceRead =
        query.model === resourceModel &&
        query.select === undefined &&
        query.join === undefined &&
        query.where.length === 1 &&
        condition?.field === 'identifier' &&
        condition.value === resourceIdentifier &&
        (condition.operator === undefined || condition.operator === 'eq') &&
        (condition.connector === undefined || condition.connector === 'AND') &&
        (condition.mode === undefined || condition.mode === 'sensitive');
      if (!isResourceRead) return findOne<T>(query);
      return retryInitialDatabaseConnection(
        () => findOne<T>(query),
        () => transactionScope.getStore() !== true,
      );
    };
    adapter.transaction = (callback) => transactionScope.run(true, () => transaction(callback));
    return adapter;
  };
}
