import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isRbacError, rbacErrorResponse, requirePermission } from "@/lib/rbac";
import { ApifyGoogleMapsService } from "@/services/apify.service";
import {
  createDemoFailedSearchJob,
  createDemoSearchJobFromLeads,
  listDemoSearchJobs
} from "@/services/demo/demo-store";
import { getDemoSecretSettings } from "@/services/demo/settings-store";
import { recordAudit } from "@/services/audit/audit.service";
import {
  createSearchJob,
  getSearchJobDto,
  startSearchJob,
  searchJobSchema,
  toSearchJobDto,
  type SearchJobInput
} from "@/services/search-jobs/search-job.service";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requirePermission("searchJobs:read");

    const jobs = await prisma.searchJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 25,
      include: { user: { select: { id: true, name: true, email: true } } }
    });

    return NextResponse.json({ jobs: jobs.map(toSearchJobDto) });
  } catch (error) {
    if (isRbacError(error)) return rbacErrorResponse(error);
    const jobs = listDemoSearchJobs();
    return NextResponse.json({ jobs });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = searchJobSchema.safeParse(body);

  try {
    const user = await requirePermission("searchJobs:create");

    if (!parsed.success) {
      return NextResponse.json({ error: "Filtros invalidos", details: parsed.error.flatten() }, { status: 400 });
    }

    const job = await createSearchJob(parsed.data, user.id);
    await recordAudit({
      action: "SEARCH_JOB_CREATED",
      entity: "SearchJob",
      entityId: job.id,
      userId: user.id,
      metadata: parsed.data,
      request
    });

    // So dispara a run na Apify (resposta rapida); a coleta avanca a cada consulta de status.
    await startSearchJob(job.id);
    const startedJob = (await getSearchJobDto(job.id)) ?? toSearchJobDto(job);

    return NextResponse.json({ job: startedJob }, { status: 202 });
  } catch (error) {
    if (isRbacError(error)) return rbacErrorResponse(error);
    if (!parsed.success) {
      return NextResponse.json({ error: "Filtros invalidos", details: parsed.error.flatten() }, { status: 400 });
    }
    return createFallbackApifySearch(request, parsed.data);
  }
}

async function createFallbackApifySearch(request: Request, filters: SearchJobInput) {
  const token = getDemoSecretSettings(request.headers.get("cookie")).apifyToken || process.env.APIFY_TOKEN || "";
  const user = { id: "development-admin-davi", name: "Davi", email: "davi@orbit.local" };

  if (!token) {
    const message = "Apify Token nao configurado. Salve o token em Configuracoes para buscar leads reais.";
    const job = createDemoFailedSearchJob(filters, message, user);
    return NextResponse.json({ error: message, job }, { status: 400 });
  }

  try {
    const rawLeads = await new ApifyGoogleMapsService(token).search(filters);
    const job = createDemoSearchJobFromLeads(filters, rawLeads, user, "Apify");
    return NextResponse.json({ job }, { status: 202 });
  } catch (apifyError) {
    const message = apifyError instanceof Error ? apifyError.message : "Falha ao buscar leads reais na Apify.";
    const job = createDemoFailedSearchJob(filters, message, user);
    return NextResponse.json({ error: message, job }, { status: 502 });
  }
}
