import { organization } from 'better-auth/plugins';

export function organizationSessionPlugin() {
  const plugin = organization();
  return {
    ...plugin,
    endpoints: {
      setActiveOrganization: plugin.endpoints.setActiveOrganization,
    },
  };
}
