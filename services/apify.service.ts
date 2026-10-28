import { z } from "zod";
import type { Lead, LeadSearchFilters } from "@/types/lead";
import { classifyWebsite, isBrazilianMobile, isInstagramUrl } from "@/utils/lead-signals";

const apifyPlaceSchema = z.object({
  title: z.string().optional(),
  name: z.string().optional(),
  phone: z.string().nullable().optional(),
  phoneUnformatted: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  categories: z.array(z.string()).optional(),
  categoryName: z.string().nullable().optional(),
  totalScore: z.number().nullable().optional(),
  reviewsCount: z.number().nullable().optional(),
  location: z
    .object({
      lat: z.number().nullable().optional(),
      lng: z.number().nullable().optional()
    })
    .nullable()
    .optional(),
  instagram: z.string().nullable().optional()
});

export type ApifyRunInfo = {
  status: string;
  datasetId: string | null;
};

export function isApifyRunFailed(status: string) {
  return status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT";
}

const defaultGoogleMapsActorId = "compass~crawler-google-places";

export function normalizeApifyActorId(actorId: string | null | undefined) {
  const value = actorId?.trim() || defaultGoogleMapsActorId;
  if (/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(value)) {
    return value.replace("/", "~");
  }

  return value;
}

export function buildApifyRunInput(filters: LeadSearchFilters) {
  const searchString = `${filters.category} em ${filters.city} ${filters.state}`.trim();

  return {
    searchString,
    searchStringsArray: [searchString],
    maxCrawledPlaces: filters.maxResults,
    maxCrawledPlacesPerSearch: filters.maxResults,
    language: "pt-BR",
    skipClosedPlaces: true,
    includeWebResults: true,
    proxyConfig: {
      useApifyProxy: true
    }
  };
}

export function normalizeApifyPlace(item: unknown, filters: LeadSearchFilters, index: number): Lead {
  const parsed = apifyPlaceSchema.safeParse(item);
  const place = parsed.success ? parsed.data : {};
  const company = normalizeText(place.title) ?? normalizeText(place.name) ?? `Empresa ${index + 1}`;
  const phone = normalizeText(place.phoneUnformatted) ?? normalizeText(place.phone);
  const rawWebsite = normalizeText(place.website);
  const websiteKind = classifyWebsite(rawWebsite);
  const website = websiteKind === "own" ? rawWebsite : null;
  const socialUrl = websiteKind === "social" ? rawWebsite : null;
  const instagram = normalizeText(place.instagram) ?? (isInstagramUrl(socialUrl) ? socialUrl : null);

  return {
    id: `${company}-${index}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    company,
    phone,
    address: normalizeText(place.address) ?? "",
    city: filters.city,
    state: filters.state,
    website,
    instagram,
    socialUrl,
    googleMapsUrl: normalizeText(place.url),
    category: filters.category,
    rating: place.totalScore ?? null,
    reviewCount: place.reviewsCount ?? null,
    latitude: place.location?.lat ?? null,
    longitude: place.location?.lng ?? null,
    hasWhatsApp: isBrazilianMobile(phone),
    status: "NEW",
    createdAt: new Date().toISOString()
  };
}

export class ApifyGoogleMapsService {
  private token: string;
  private actorId: string;

  constructor(token = process.env.APIFY_TOKEN ?? "", actorId = process.env.APIFY_GOOGLE_MAPS_ACTOR_ID ?? "") {
    this.token = token;
    this.actorId = normalizeApifyActorId(actorId);
  }

  // Busca completa esperando a Apify (so usada no modo demonstracao sem banco).
  async search(filters: LeadSearchFilters): Promise<Lead[]> {
    const runId = await this.startRun(filters);

    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const run = await this.getRun(runId);
      if (run.status === "SUCCEEDED" && run.datasetId) return this.fetchLeads(run.datasetId, filters);
      if (isApifyRunFailed(run.status)) throw new Error(`Run Apify finalizada com status ${run.status}.`);
    }

    throw new Error("Tempo limite aguardando resultados da Apify.");
  }

  async startRun(filters: LeadSearchFilters): Promise<string> {
    this.assertToken();

    const runResponse = await fetch(`https://api.apify.com/v2/acts/${encodeURIComponent(this.actorId)}/runs?token=${this.token}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildApifyRunInput(filters))
    });

    if (!runResponse.ok) {
      throw new Error(await buildApifyStartError(runResponse, this.actorId));
    }

    const run = (await runResponse.json()) as { data?: { id?: string } };
    const runId = run.data?.id;
    if (!runId) throw new Error("Apify nao retornou run id.");
    return runId;
  }

  async getRun(runId: string): Promise<ApifyRunInfo> {
    this.assertToken();
    const response = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${this.token}`);
    if (!response.ok) {
      throw new Error(`Falha ao consultar a run Apify: ${response.status}`);
    }

    const payload = (await response.json()) as { data?: { status?: string; defaultDatasetId?: string } };
    return { status: payload.data?.status ?? "UNKNOWN", datasetId: payload.data?.defaultDatasetId ?? null };
  }

  async fetchLeads(datasetId: string, filters: LeadSearchFilters): Promise<Lead[]> {
    this.assertToken();
    const itemsResponse = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&token=${this.token}`);

    if (!itemsResponse.ok) {
      throw new Error(`Falha ao carregar dataset Apify: ${itemsResponse.status}`);
    }

    const items = (await itemsResponse.json()) as unknown[];
    return items.map((item, index) => this.normalizePlace(item, filters, index));
  }

  private assertToken() {
    if (!this.token) {
      throw new Error("APIFY_TOKEN nao configurado.");
    }
  }

  private normalizePlace(item: unknown, filters: LeadSearchFilters, index: number): Lead {
    return normalizeApifyPlace(item, filters, index);
  }
}

function normalizeText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed || null;
}

async function buildApifyStartError(response: Response, actorId: string) {
  const details = await readApifyErrorMessage(response);

  if (response.status === 401 || response.status === 403) {
    return "Token Apify invalido ou sem permissao. Confira o token salvo em Configuracoes.";
  }

  if (response.status === 402) {
    return "A conta Apify nao possui creditos suficientes para iniciar a busca.";
  }

  if (response.status === 404) {
    return `Actor Apify nao encontrado (${actorId}). Use compass~crawler-google-places ou configure APIFY_GOOGLE_MAPS_ACTOR_ID no Vercel.`;
  }

  return details ? `Falha ao iniciar Apify: ${response.status} - ${details}` : `Falha ao iniciar Apify: ${response.status}`;
}

async function readApifyErrorMessage(response: Response) {
  try {
    const payload = (await response.clone().json()) as { error?: { message?: string } };
    return payload.error?.message ?? "";
  } catch {
    try {
      return (await response.clone().text()).slice(0, 180);
    } catch {
      return "";
    }
  }
}
