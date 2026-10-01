export type ProviderConnectionMode =
  | 'service-selection'
  | 'provider-handoff'
  | 'oauth'
  | 'deep-link';

export type ProviderConnectionDefinition = {
  providerId: string;
  mode: ProviderConnectionMode;
  status: 'available' | 'not-configured';
  authUrl: string | null;
  launchUrl: string | null;
  notes: string;
};

const providerUrls: Record<string, string> = {
  netflix: 'https://www.netflix.com/',
  'prime-video': 'https://www.primevideo.com/',
  max: 'https://www.max.com/',
  'disney-plus': 'https://www.disneyplus.com/',
  hulu: 'https://www.hulu.com/',
  'paramount-plus': 'https://www.paramountplus.com/',
  peacock: 'https://www.peacocktv.com/',
  'apple-tv-plus': 'https://tv.apple.com/',
  'mgm-plus': 'https://www.mgmplus.com/',
  starz: 'https://www.starz.com/',
  'amc-plus': 'https://www.amcplus.com/',
  crunchyroll: 'https://www.crunchyroll.com/',
  'discovery-plus': 'https://www.discoveryplus.com/',
  espn: 'https://www.espn.com/',
  'espn-plus': 'https://www.espn.com/watch/',
  fubo: 'https://www.fubo.tv/',
  sling: 'https://www.sling.com/',
  'youtube-tv': 'https://tv.youtube.com/',
  philo: 'https://www.philo.com/',
  britbox: 'https://www.britbox.com/',
  'acorn-tv': 'https://acorn.tv/',
  shudder: 'https://www.shudder.com/',
  mubi: 'https://mubi.com/',
  hallmark: 'https://www.hallmarkplus.com/',
  criterion: 'https://www.criterionchannel.com/',
  dropout: 'https://www.dropout.tv/',
  hidive: 'https://www.hidive.com/',
  tubi: 'https://tubitv.com/',
  'pluto-tv': 'https://pluto.tv/',
  'roku-channel': 'https://www.roku.com/',
  plex: 'https://www.plex.tv/',
};

export function getProviderConnection(providerId: string): ProviderConnectionDefinition {
  const launchUrl = providerUrls[providerId] || null;
  return {
    providerId,
    mode: launchUrl ? 'provider-handoff' : 'service-selection',
    status: 'available',
    authUrl: null,
    launchUrl,
    notes: launchUrl
      ? 'Open the provider outside Stream Command. Stream Command does not collect provider credentials.'
      : 'Service selection is available; a provider handoff can be added when a supported URL or official integration is verified.',
  };
}
