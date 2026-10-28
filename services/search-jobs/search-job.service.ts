import { SearchJobStatus, type Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ApifyGoogleMapsService, isApifyRunFailed } from "@/services/apify.service";
import { recordAudit } from "@/services/audit/audit.service";
import { filterLeads } from "@/services/lead-filter.service";
import type { Lead, LeadSearchFilters } from "@/types/lead";
import type { SearchJobDto } from "@/types/search-job";

export const searchJobSchema = z.object({
  state: z.string().min(2),
  city: z.string().min(2),
  category: z.string().min(2),
  maxResults: z.coerce.number().min(1).max(500).default(50),
  minRating: z.coerce.number().min(0).max(5).default(0),
  minReviews: z.coerce.number().min(0).default(0),
  onlyWithoutWebsite: z.boolean().default(false),
  onlyWithPhone: z.boolean().default(true),
  onlyWithWhatsApp: z.boolean().default(false),
  ignoreDuplicates: z.boolean().default(true)
});

export type SearchJobInput = z.infer<typeof searchJobSchema>;
type JobWithUser = Prisma.SearchJobGetPayload<{
  include: { user: { select: { id: true; name: true; email: true } } };
}>;

const runningJobs = new Set<string>();
const jobInclude = { user: { select: { id: true, name: true, email: true } } } as const;

// Progresso de cada fase. A busca nao roda "solta" no servidor (a Vercel encerra a funcao
// quando a resposta sai): o POST so inicia a run na Apify e cada consulta de status
// (SSE / GET do job) avanca o job um passo com advanceSearchJob.
const PROGRESS_COLLECTING = 25;
const PROGRESS_SAVING = 65;
const SEARCH_TIMEOUT_MS = 20 * 60 * 1000;
const STALE_SAVE_MS = 2 * 60 * 1000;

export function toSearchJobDto(job: JobWithUser): SearchJobDto {
  return {
    id: job.id,
    status: job.status,
    state: job.state,
    city: job.city,
    category: job.category,
    maxResults: job.maxResults,
    minRating: job.minRating,
    minReviews: job.minReviews,
    progress: job.progress,
    message: job.message,
    resultCount: job.resultCount,
    duplicateCount: job.duplicateCount,
    error: job.error,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    user: job.user
  };
}

export async function createSearchJob(filters: SearchJobInput, userId?: string) {
  return prisma.searchJob.create({
    data: {
      state: filters.state,
      city: filters.city,
      category: filters.category,
      maxResults: filters.maxResults,
      minRating: filters.minRating,
      minReviews: filters.minReviews,
      filters,
      userId,
      message: "Busca adicionada a fila"
    },
    include: { user: { select: { id: true, name: true, email: true } } }
  });
}

export async function getSearchJobDto(jobId: string) {
  const job = await prisma.searchJob.findUnique({ where: { id: jobId }, include: jobInclude });
  return job ? toSearchJobDto(job) : null;
}

export async function startSearchJob(jobId: string) {
  try {
    const job = await prisma.searchJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== SearchJobStatus.PENDING) return;

    const filters: LeadSearchFilters = searchJobSchema.parse(job.filters);
    const runId = await (await createApifyService()).startRun(filters);

    await updateJob(jobId, {
      status: SearchJobStatus.RUNNING,
      startedAt: new Date(),
      apifyRunId: runId,
      progress: PROGRESS_COLLECTING,
      message: "Coletando empresas no Google Maps via Apify"
    });
  } catch (error) {
    await failJob(jobId, error);
  }
}

export async function advanceSearchJob(jobId: string) {
  if (runningJobs.has(jobId)) return;
  runningJobs.add(jobId);

  try {
    const job = await prisma.searchJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== SearchJobStatus.RUNNING || !job.apifyRunId) return;

    // Outra requisicao ja esta gravando os leads; so assume se ela parou de dar sinal.
    const savingInProgress = job.progress >= PROGRESS_SAVING && Date.now() - job.updatedAt.getTime() < STALE_SAVE_MS;
    if (savingInProgress) return;

    const filters: LeadSearchFilters = searchJobSchema.parse(job.filters);
    const service = await createApifyService();
    const run = await service.getRun(job.apifyRunId);

    if (isApifyRunFailed(run.status)) {
      throw new Error(`A Apify encerrou a busca com status ${run.status}.`);
    }

    if (run.status !== "SUCCEEDED" || !run.datasetId) {
      const elapsedMs = Date.now() - (job.startedAt ?? job.createdAt).getTime();
      if (elapsedMs > SEARCH_TIMEOUT_MS) {
        throw new Error("A Apify passou de 20 minutos sem terminar. Tente uma busca com menos resultados.");
      }

      const elapsedMinutes = Math.floor(elapsedMs / 60_000);
      await updateJob(jobId, {
        progress: Math.min(PROGRESS_SAVING - 5, PROGRESS_COLLECTING + Math.floor(elapsedMs / 10_000)),
        message: `Coletando empresas no Google Maps via Apify${elapsedMinutes > 0 ? ` (${elapsedMinutes} min)` : ""}`
      });
      return;
    }

    // Trava otimista: so uma requisicao grava os leads (quem chegar depois ve updatedAt diferente).
    const claimed = await prisma.searchJob.updateMany({
      where: { id: jobId, status: SearchJobStatus.RUNNING, updatedAt: job.updatedAt },
      data: { progress: PROGRESS_SAVING, message: "Aplicando filtros e removendo duplicados" }
    });
    if (claimed.count === 0) return;

    const rawLeads = await service.fetchLeads(run.datasetId, filters);
    const leads = filterLeads(rawLeads, filters);
    const duplicates = Math.max(0, rawLeads.length - leads.length);

    await updateJob(jobId, { progress: 78, message: "Gravando leads no PostgreSQL" });
    const saved = await persistLeads(jobId, leads);
    const finalMessage = buildSearchResultMessage(rawLeads.length, leads.length, saved);

    await prisma.searchHistory.create({
      data: {
        state: filters.state,
        city: filters.city,
        category: filters.category,
        maxResults: filters.maxResults,
        minRating: filters.minRating,
        minReviews: filters.minReviews,
        filters,
        leadsFound: saved,
        duplicates,
        userId: job.userId
      }
    });

    await updateJob(jobId, {
      status: SearchJobStatus.SUCCEEDED,
      progress: 100,
      message: finalMessage,
      resultCount: saved,
      duplicateCount: duplicates,
      completedAt: new Date()
    });

    await recordAudit({
      action: "SEARCH_JOB_SUCCEEDED",
      entity: "SearchJob",
      entityId: jobId,
      userId: job.userId,
      metadata: { saved, duplicates }
    });
  } catch (error) {
    await failJob(jobId, error);
  } finally {
    runningJobs.delete(jobId);
  }
}

async function createApifyService() {
  const settings = await prisma.appSettings.findFirst({ select: { apifyToken: true } });
  const token = settings?.apifyToken?.trim() || process.env.APIFY_TOKEN || "";
  if (!token) {
    throw new Error("Apify Token nao configurado. Cadastre o token em Configuracoes para buscar leads reais.");
  }

  return new ApifyGoogleMapsService(token);
}

async function failJob(jobId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Falha inesperada na busca.";
  const job = await prisma.searchJob
    .update({
      where: { id: jobId },
      data: {
        status: SearchJobStatus.FAILED,
        progress: 100,
        message: "Busca falhou",
        error: message,
        completedAt: new Date()
      }
    })
    .catch(() => null);

  await recordAudit({
    action: "SEARCH_JOB_FAILED",
    entity: "SearchJob",
    entityId: jobId,
    userId: job?.userId,
    metadata: { error: message }
  });
}

async function updateJob(jobId: string, data: Prisma.SearchJobUpdateInput) {
  await prisma.searchJob.update({ where: { id: jobId }, data });
}

async function persistLeads(jobId: string, leads: Lead[]) {
  let saved = 0;
  const categoryIds = new Map<string, string>();
  const cityIds = new Map<string, string>();

  for (const lead of leads) {
    let categoryId = categoryIds.get(lead.category);
    if (!categoryId) {
      const category = await prisma.category.upsert({
        where: { name: lead.category },
        update: {},
        create: { name: lead.category }
      });
      categoryId = category.id;
      categoryIds.set(lead.category, categoryId);
    }

    const cityKey = `${lead.city}|${lead.state}`;
    let cityId = cityIds.get(cityKey);
    if (!cityId) {
      const city = await prisma.city.upsert({
        where: { name_state: { name: lead.city, state: lead.state } },
        update: {},
        create: { name: lead.city, state: lead.state }
      });
      cityId = city.id;
      cityIds.set(cityKey, cityId);
    }

    await prisma.lead.upsert({
      where: {
        company_phone_cityName: {
          company: lead.company,
          phone: lead.phone ?? "",
          cityName: lead.city
        }
      },
      update: {
        website: lead.website,
        instagram: lead.instagram,
        googleMaps: lead.googleMapsUrl,
        rating: lead.rating,
        reviewCount: lead.reviewCount,
        latitude: lead.latitude,
        longitude: lead.longitude,
        hasWhatsApp: lead.hasWhatsApp,
        categoryId,
        cityId,
        rawPayload: lead
      },
      create: {
        company: lead.company,
        phone: lead.phone ?? "",
        address: lead.address,
        cityName: lead.city,
        state: lead.state,
        website: lead.website,
        instagram: lead.instagram,
        googleMaps: lead.googleMapsUrl,
        rating: lead.rating,
        reviewCount: lead.reviewCount,
        latitude: lead.latitude,
        longitude: lead.longitude,
        hasWhatsApp: lead.hasWhatsApp,
        status: lead.status,
        categoryId,
        cityId,
        rawPayload: lead
      }
    });
    saved += 1;

    // Mantem updatedAt fresco pra outra requisicao nao achar que a gravacao travou.
    if (saved % 50 === 0) {
      await updateJob(jobId, { message: `Gravando leads (${saved}/${leads.length})` });
    }
  }

  return saved;
}

function buildSearchResultMessage(rawCount: number, filteredCount: number, savedCount: number) {
  if (savedCount > 0) {
    return `Busca concluida: ${savedCount} leads salvos de ${rawCount} empresas retornadas pela Apify.`;
  }

  if (rawCount > 0 && filteredCount === 0) {
    return `Apify retornou ${rawCount} empresas, mas os filtros atuais removeram todas. Tente desmarcar "sem site" ou "WhatsApp" e reduzir nota/avaliacoes.`;
  }

  return "Apify nao retornou empresas para essa combinacao. Tente outra categoria, cidade ou filtros mais amplos.";
}
