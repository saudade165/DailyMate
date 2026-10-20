// Public settings. Everything in this file is visible to every visitor, so it
// must NEVER contain secret keys (AI provider keys, service-role keys, passwords).
// Secrets live only on the server — see supabase/README.md.

export const AI_CONFIG = {
  // HTTPS address of the DailyMate AI server function
  // (e.g. https://<project>.supabase.co/functions/v1/ai-assistant).
  // Empty means the AI Assistant is not connected yet.
  endpoint: '',
};
