const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  "email_doesn't_match":
    'That provider account uses a different email than your Orbit account. Connect one whose primary email matches, or line up the emails first.',
  account_already_linked_to_different_user:
    'That provider account is already linked to a different Orbit user. Sign in as that user, or disconnect it there first.',
  unable_to_link_account:
    'We could not link that account. The provider did not return a verified email, so linking was declined.',
  unable_to_get_user_info:
    'The provider did not share your account details. Check the connection permissions and try again.',
  email_not_found: 'No Orbit account matches that provider email. Sign up first, then connect it.',
  email_domain_not_allowed:
    'Your email domain is not allowed on this workspace. Ask an admin to invite you.',
  signup_disabled: 'New accounts are not open on this server. Ask an admin for an invite.',
  access_denied: 'You cancelled before granting access. Try again when you are ready.',
  no_code: 'The sign in did not finish. Start again.',
  invalid_code: 'The sign in link expired before it completed. Start again.',
  oauth_code_verification_failed: 'The sign in could not be verified. Start again.',
  state_not_found: 'This sign in took too long and expired. Start again.',
  please_restart_the_process: 'This sign in took too long and expired. Start again.',
  no_callback_url: 'Something went wrong finishing the sign in. Start again.',
  oauth_provider_not_found: 'That provider is not configured on this server.',
  internal_server_error: 'Something went wrong on our end. Try again in a moment.',
};

export function describeAuthError(rawCode: string): string {
  const known = OAUTH_ERROR_MESSAGES[rawCode.trim().toLowerCase()];
  if (known !== undefined) return known;
  return 'We could not complete that sign in. Please try again.';
}

export function authErrorCode(value: string | string[] | undefined): string | undefined {
  const code = Array.isArray(value) ? value[0] : value;
  return code !== undefined && code.length > 0 ? code : undefined;
}
