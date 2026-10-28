import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isRbacError, rbacErrorResponse, requirePermission } from "@/lib/rbac";
import { getDemoSearchJob } from "@/services/demo/demo-store";
import { advanceSearchJob, toSearchJobDto } from "@/services/search-jobs/search-job.service";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("searchJobs:read");
    const { id } = await params;
    await advanceSearchJob(id);
    const job = await prisma.searchJob.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, email: true } } }
    });

    if (!job) {
      return NextResponse.json({ error: "Busca nao encontrada." }, { status: 404 });
    }

    return NextResponse.json({ job: toSearchJobDto(job) });
  } catch (error) {
    if (isRbacError(error)) return rbacErrorResponse(error);
    const { id } = await params;
    const job = getDemoSearchJob(id);
    if (!job) {
      return NextResponse.json({ error: "Busca nao encontrada." }, { status: 404 });
    }

    return NextResponse.json({
      job
    });
  }
}
