import { prisma } from "@/lib/prisma";
import { isRbacError, rbacErrorResponse, requirePermission } from "@/lib/rbac";
import { getDemoSearchJob } from "@/services/demo/demo-store";
import { advanceSearchJob, toSearchJobDto } from "@/services/search-jobs/search-job.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const terminalStatuses = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);
// Consulta a Apify a cada 4 ticks (~4s); o banco e lido a cada 1s.
const ADVANCE_EVERY_TICKS = 4;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("searchJobs:read");
    const { id } = await params;
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;

        request.signal.addEventListener("abort", () => {
          closed = true;
          try {
            controller.close();
          } catch {
            // A conexao pode ja ter sido encerrada pelo navegador.
          }
        });

        let tick = 0;
        while (!closed) {
          if (tick % ADVANCE_EVERY_TICKS === 0) await advanceSearchJob(id);
          tick += 1;
          const job = await prisma.searchJob.findUnique({
            where: { id },
            include: { user: { select: { id: true, name: true, email: true } } }
          });

          if (!job) {
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: "Busca nao encontrada." })}\n\n`));
            break;
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify(toSearchJobDto(job))}\n\n`));
          if (terminalStatuses.has(job.status)) break;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        try {
          controller.close();
        } catch {
          // O cliente pode fechar antes do servidor.
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      }
    });
  } catch (error) {
    if (isRbacError(error)) return rbacErrorResponse(error);
    const { id } = await params;
    const demoJob = getDemoSearchJob(id) ?? { error: "Busca nao encontrada." };

    return new Response(`data: ${JSON.stringify(demoJob)}\n\n`, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      }
    });
  }
}
