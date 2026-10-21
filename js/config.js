// Public settings. Everything in this file is visible to every visitor, so it
// must NEVER contain secret keys (AI provider keys, service-role/secret keys, passwords).
// Secrets live only on the server — see supabase/README.md.

export const SUPABASE_CONFIG = {
  url: 'https://aboenuyweqirlhdzrehd.supabase.co',
  // The publishable key is meant to be public: it only allows what Row Level
  // Security permits for the signed-in person (their own data).
  publishableKey: 'sb_publishable_MwijWPPb8ihrgRQ0GM1oVA_dQy3cgtW',
};

// Where links in sign-up and password e-mails may return to. Anything else falls back to
// production, so a link can never send someone to an address taken from the URL.
// Each address must also be listed in Supabase → Authentication → URL Configuration.
export const APP_URLS = {
  production: 'https://saudade165.github.io/DailyMate/',
  development: ['http://localhost:5174/', 'http://127.0.0.1:5174/'],
};

export const AI_CONFIG = {
  // HTTPS address of the DailyMate AI server function
  // (e.g. https://<project>.supabase.co/functions/v1/ai-assistant).
  // Empty means the AI Assistant is not connected yet.
  endpoint: '',
};

// Shown in the Privacy Policy and Terms. Empty values appear as clearly marked
// placeholders. The owner must fill these in (and have the texts reviewed) before
// a commercial launch — they are not invented here.
export const LEGAL = {
  operator: '',        // legal name of the person or company that runs DailyMate
  contactEmail: '',    // privacy and support contact
  address: '',         // mailing address
  privacyOfficer: '',  // person responsible for privacy (PIPEDA / Quebec Law 25)
  lastUpdated: '2026-10-21',
};
