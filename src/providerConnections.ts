export type ProviderConnectionMode =
  | 'oauth'
  | 'provider-handoff'
  | 'deep-link'
  | 'manual-selection';

export type ProviderConnectionDefinition = {
  providerId: string;
  mode: ProviderConnectionMode;
  status: 'configured' | 'not-configured';
  authUrl: string | null;
  notes: string;
};

const configuredProviders = new Set<string>();

export function getProviderConnection(providerId: string): ProviderConnectionDefinition {
  return {
    providerId,
    mode: 'provider-handoff',
    status: configuredProviders.has(providerId) ? 'configured' : 'not-configured',
    authUrl: null,
    notes: configuredProviders.has(providerId)
      ? 'Provider adapter is configured.'
      : 'Provider authentication must be wired through a supported provider flow before the account can be marked connected.',
  };
}

export function isProviderConnectionConfigured(providerId: string): boolean {
  return configuredProviders.has(providerId);
}
