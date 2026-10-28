import { onlyDigits } from "@/utils/formatters";

// WhatsApp so existe em celular: DDD (2 digitos) + 9 + 8 digitos.
// Fixo (DDD + 8 digitos comecando em 2-5) nao conta.
export function isBrazilianMobile(phone: string | null | undefined) {
  let digits = onlyDigits(phone ?? "");
  if (digits.startsWith("55") && digits.length >= 12) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits.length === 11 && digits[2] === "9";
}

export type WebsiteKind = "none" | "social" | "own";

// Links que o Google Maps aceita no campo "site" mas que nao sao site proprio.
// Empresa com so um desses e lead de venda de site, nao descarte.
const socialHosts = [
  "instagram.com",
  "facebook.com",
  "fb.com",
  "fb.me",
  "m.me",
  "wa.me",
  "whatsapp.com",
  "linktr.ee",
  "linkr.bio",
  "bio.link",
  "beacons.ai",
  "taplink.cc",
  "taplink.at",
  "msha.ke",
  "tiktok.com",
  "youtube.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "ifood.com.br",
  "business.site",
  "g.page"
];

export function classifyWebsite(url: string | null | undefined): WebsiteKind {
  const host = extractHost(url);
  if (!host) return "none";
  return socialHosts.some((social) => host === social || host.endsWith(`.${social}`)) ? "social" : "own";
}

export function isInstagramUrl(url: string | null | undefined) {
  const host = extractHost(url);
  return host === "instagram.com" || Boolean(host?.endsWith(".instagram.com"));
}

function extractHost(url: string | null | undefined) {
  const value = url?.trim();
  if (!value) return null;

  try {
    const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
