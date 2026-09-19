import {
  computeRestoreTargetIdentity,
  type RestoreTargetIdentity,
  validationFailed,
} from '@orbit/shared';

export function assertRestoreTargetConfirmed(
  databaseUrl: string,
  bucket: string | undefined,
  confirmation: string | undefined,
): RestoreTargetIdentity {
  if (databaseUrl.length === 0) {
    throw validationFailed('Target database connection URL is required for restore.');
  }

  const target = computeRestoreTargetIdentity(databaseUrl, bucket);
  const trimmedConfirmation = confirmation?.trim();

  if (trimmedConfirmation === undefined || trimmedConfirmation.length === 0) {
    throw validationFailed(
      `Refusing to restore into target "${target.identity}". Pass --confirm-destructive-restore-target=${target.identity} to confirm this destructive operation.`,
    );
  }

  if (trimmedConfirmation !== target.identity) {
    throw validationFailed(
      `Destructive restore confirmation "${trimmedConfirmation}" does not match target identity "${target.identity}". Pass --confirm-destructive-restore-target=${target.identity} to confirm.`,
    );
  }

  return target;
}
