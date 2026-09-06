export function slackFeatureEnabled(): boolean {
  return process.env['SLACK_ENABLED']?.trim().toLowerCase() === 'true';
}
