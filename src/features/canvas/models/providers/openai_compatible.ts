// ---------------------------------------------------------------------------
// Provider definition type — used by registry.ts
// ---------------------------------------------------------------------------

export interface ModelProviderDefinition {
  id: string;
  displayName: string;
  description?: string;
  enabledByDefault: boolean;
  defaultBaseUrl: string;
  registerUrl?: string;
  getKeyUrl?: string;
  authHeaderFormat?: "Bearer" | "Key";
}



