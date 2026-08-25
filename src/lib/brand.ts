/** Canonical Buildable Labs mark — files live in /public. */
export const BRAND_LOGO = '/buildable-labs-payment-logo.png';

/** Browser / on-screen src. Falls back to the bundled mark when the profile has none. */
export function displayLogo(url?: string | null) {
  const v = (url ?? '').trim();
  return v || BRAND_LOGO;
}
