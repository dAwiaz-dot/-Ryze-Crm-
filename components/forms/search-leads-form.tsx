"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Clock3, Loader2, MapPin, Rocket, SlidersHorizontal, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { initialCategories } from "@/data/categories";
import { sulMinasCities } from "@/data/sul-minas-cities";
import type { LeadSearchFilters } from "@/types/lead";
import type { SearchJobDto, SearchJobStatus } from "@/types/search-job";

const defaultFilters: LeadSearchFilters = {
  state: "MG",
  city: "Pouso Alegre",
  category: "Dentistas",
  maxResults: 80,
  minRating: 4,
  minReviews: 20,
  onlyWithoutWebsite: true,
  onlyWithPhone: true,
  onlyWithWhatsApp: true,
  ignoreDuplicates: true
};

const statusLabels: Record<SearchJobStatus, string> = {
  PENDING: "Na fila",
  RUNNING: "Rodando",
  SUCCEEDED: "Concluida",
  FAILED: "Falhou",
  CANCELLED: "Cancelada"
};

const statusTones: Record<SearchJobStatus, "info" | "secondary" | "success" | "warning" | "danger"> = {
  PENDING: "secondary",
  RUNNING: "info",
  SUCCEEDED: "success",
  FAILED: "danger",
  CANCELLED: "warning"
};

const terminalStatuses = new Set<SearchJobStatus>(["SUCCEEDED", "FAILED", "CANCELLED"]);

export function SearchLeadsForm() {
  const [filters, setFilters] = useState(defaultFilters);
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<SearchJobDto[]>([]);
  const [activeJob, setActiveJob] = useState<SearchJobDto | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    void loadJobs();
    return () => eventSourceRef.current?.close();
  }, []);

  function update<K extends keyof LeadSearchFilters>(key: K, value: LeadSearchFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  async function loadJobs() {
    const response = await fetch("/api/search-jobs");
    if (!response.ok) {
      toast.error(response.status === 401 ? "Faca login para buscar leads" : "Nao foi possivel carregar a fila");
      return;
    }

    const payload = (await response.json()) as { jobs: SearchJobDto[] };
    setJobs(payload.jobs);
    setActiveJob((current) => current ?? payload.jobs[0] ?? null);

    // Retoma o acompanhamento se a pagina foi recarregada com uma busca em andamento.
    const runningJob = payload.jobs.find((job) => !terminalStatuses.has(job.status));
    if (runningJob && !eventSourceRef.current) connectToJob(runningJob.id);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);

    const response = await fetch("/api/search-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(filters)
    });

    setLoading(false);
    const payload = (await response.json().catch(() => ({}))) as { job?: SearchJobDto; error?: string };
    if (!response.ok || !payload.job) {
      handleSearchError(response.status, payload.error);
      return;
    }

    const job = payload.job;
    setActiveJob(job);
    setJobs((current) => upsertJob(current, job));
    if (!terminalStatuses.has(job.status)) {
      connectToJob(job.id);
      toast.success("Busca adicionada a fila");
      return;
    }

    showSearchResultToast(job);
  }

  function connectToJob(jobId: string) {
    eventSourceRef.current?.close();
    const source = new EventSource(`/api/search-jobs/${jobId}/events`);
    eventSourceRef.current = source;

    source.onmessage = (event) => {
      const job = JSON.parse(event.data) as SearchJobDto;
      setActiveJob(job);
      setJobs((current) => upsertJob(current, job));
      if (terminalStatuses.has(job.status)) {
        source.close();
        eventSourceRef.current = null;
      }
    };

    source.onerror = () => {
      source.close();
      eventSourceRef.current = null;
      void refreshJob(jobId);
    };
  }

  async function refreshJob(jobId: string) {
    const response = await fetch(`/api/search-jobs/${jobId}`);
    const payload = (await response.json().catch(() => ({}))) as { job?: SearchJobDto; error?: string };

    if (!response.ok || !payload.job) {
      if (response.status !== 404) handleSearchError(response.status, payload.error);
      return;
    }

    const job = payload.job;
    setActiveJob(job);
    setJobs((current) => upsertJob(current, job));

    // A conexao SSE cai quando a funcao serverless atinge o limite de tempo; reconecta
    // enquanto a busca nao terminar (e a propria consulta faz a busca avancar).
    if (!terminalStatuses.has(job.status)) {
      window.setTimeout(() => connectToJob(job.id), 3000);
    } else {
      showSearchResultToast(job);
    }
  }

  function handleSearchError(status: number, message?: string) {
    if (status === 401) {
      toast.error("Sessao expirada", { description: "Entre novamente para gerar leads." });
      window.location.assign(`/login?callbackUrl=${encodeURIComponent("/buscar-leads")}`);
      return;
    }

    if (status === 403) {
      toast.error("Seu perfil nao pode gerar leads", { description: "Use um perfil Administrador ou Vendedor." });
      return;
    }

    toast.error(message ?? "Nao foi possivel criar a busca");
  }

  function showSearchResultToast(job: SearchJobDto) {
    if (job.resultCount > 0) {
      toast.success(`${job.resultCount} leads gerados`, { description: job.message });
      return;
    }

    toast.warning("Busca concluida sem leads", { description: job.message });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,520px)_1fr]">
      <Card className="glass-panel">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <SlidersHorizontal className="h-5 w-5 text-primary" />
              Parametros da busca
            </CardTitle>
            <Badge variant="info">Google Maps</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Estado</Label>
                <Select value={filters.state} onValueChange={(value) => update("state", value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Estado" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MG">Minas Gerais</SelectItem>
                    <SelectItem value="SP">Sao Paulo</SelectItem>
                    <SelectItem value="RJ">Rio de Janeiro</SelectItem>
                    <SelectItem value="PR">Parana</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Cidade</Label>
                <Select value={filters.city} onValueChange={(value) => update("city", value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Cidade" />
                  </SelectTrigger>
                  <SelectContent>
                    {sulMinasCities.map((city) => (
                      <SelectItem key={city} value={city}>
                        {city}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={filters.category} onValueChange={(value) => update("category", value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Categoria" />
                </SelectTrigger>
                <SelectContent>
                  {initialCategories.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Quantidade maxima</Label>
                <Input type="number" min={1} max={500} value={filters.maxResults} onChange={(event) => update("maxResults", Number(event.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Nota minima</Label>
                <Input type="number" min={0} max={5} step={0.1} value={filters.minRating} onChange={(event) => update("minRating", Number(event.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Min. avaliacoes</Label>
                <Input type="number" min={0} value={filters.minReviews} onChange={(event) => update("minReviews", Number(event.target.value))} />
              </div>
            </div>

            <div className="grid gap-3 rounded-lg border bg-background/70 p-4">
              {[
                ["onlyWithoutWebsite", "Somente sem site proprio (inclui quem so tem Instagram/Facebook)"],
                ["onlyWithPhone", "Somente empresas com telefone"],
                ["onlyWithWhatsApp", "Somente celular (WhatsApp)"],
                ["ignoreDuplicates", "Ignorar duplicados"]
              ].map(([key, label]) => (
                <label key={key} className="flex cursor-pointer items-center gap-3 text-sm font-medium">
                  <Checkbox
                    checked={Boolean(filters[key as keyof LeadSearchFilters])}
                    onCheckedChange={(checked) => update(key as keyof LeadSearchFilters, Boolean(checked) as never)}
                  />
                  {label}
                </label>
              ))}
            </div>

            <Button size="lg" variant="premium" className="h-14 w-full text-base" disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Rocket className="mr-2 h-5 w-5" />}
              GERAR LEADS
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card className="glass-panel">
          <CardHeader>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-accent" />
                Status em tempo real
              </CardTitle>
              {activeJob && <Badge variant={statusTones[activeJob.status]}>{statusLabels[activeJob.status]}</Badge>}
            </div>
          </CardHeader>
          <CardContent>
            {activeJob ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Metric label="Cidade" value={`${activeJob.city}/${activeJob.state}`} />
                  <Metric label="Categoria" value={activeJob.category} />
                  <Metric label="Leads gravados" value={String(activeJob.resultCount)} />
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{activeJob.message}</span>
                    <span>{activeJob.progress}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full bg-[linear-gradient(90deg,#1E68FF,#16B8A6)] transition-all dark:bg-[linear-gradient(90deg,#FFFFFF,#8A8A8A)]" style={{ width: `${activeJob.progress}%` }} />
                  </div>
                </div>
                {activeJob.error && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{activeJob.error}</p>}
                {activeJob.status === "SUCCEEDED" && activeJob.resultCount === 0 && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    {activeJob.message}
                  </p>
                )}
                {activeJob.status === "SUCCEEDED" && activeJob.resultCount > 0 && (
                  <Button asChild variant="premium">
                    <Link href="/leads">
                      Ver leads gerados
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid min-h-[180px] place-items-center rounded-lg border border-dashed bg-background/70 p-6 text-center text-sm text-muted-foreground">
                Nenhuma busca ativa ainda.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="glass-panel">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              Fila de buscas Apify
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Busca</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Progresso</TableHead>
                  <TableHead>Resultado</TableHead>
                  <TableHead>Hora</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id} className="cursor-pointer" onClick={() => setActiveJob(job)}>
                    <TableCell>
                      <div className="font-medium">{job.category}</div>
                      <div className="text-xs text-muted-foreground">{job.city}/{job.state}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusTones[job.status]}>{statusLabels[job.status]}</Badge>
                    </TableCell>
                    <TableCell>{job.progress}%</TableCell>
                    <TableCell>{job.resultCount} leads</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <Clock3 className="mr-1 inline h-3 w-3" />
                      {new Date(job.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </TableCell>
                  </TableRow>
                ))}
                {!jobs.length && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-28 text-center text-muted-foreground">
                      Nenhuma busca enviada para a fila.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-lg font-bold">{value}</p>
    </div>
  );
}

function upsertJob(jobs: SearchJobDto[], job: SearchJobDto) {
  const exists = jobs.some((item) => item.id === job.id);
  if (!exists) return [job, ...jobs];
  return jobs.map((item) => (item.id === job.id ? job : item));
}
