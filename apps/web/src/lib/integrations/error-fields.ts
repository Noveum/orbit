import { databaseLogFields } from '@orbit/shared/utils';

export function integrationErrorFields(error: unknown) {
  return databaseLogFields(error) ?? { error: 'Integration request failed.' };
}
