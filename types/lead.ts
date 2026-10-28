export type LeadStatus = "NEW" | "SENT" | "REPLIED" | "INTERESTED" | "MEETING" | "PROPOSAL" | "CLIENT" | "LOST";

export type Lead = {
  id: string;
  company: string;
  phone: string | null;
  address: string;
  city: string;
  state: string;
  website: string | null;
  instagram: string | null;
  // Link de rede social/agregador que veio no campo "site" do Google Maps (fica so no rawPayload).
  socialUrl?: string | null;
  googleMapsUrl: string | null;
  category: string;
  rating: number | null;
  reviewCount: number | null;
  latitude: number | null;
  longitude: number | null;
  hasWhatsApp: boolean;
  status: LeadStatus;
  createdAt: string;
};

export type LeadSearchFilters = {
  state: string;
  city: string;
  category: string;
  maxResults: number;
  minRating: number;
  minReviews: number;
  onlyWithoutWebsite: boolean;
  onlyWithPhone: boolean;
  onlyWithWhatsApp: boolean;
  ignoreDuplicates: boolean;
};

export type LeadMetric = {
  label: string;
  value: string;
  trend: string;
  tone: "blue" | "green" | "amber" | "rose" | "slate";
};

export type PaginatedLeadsResult = {
  leads: Lead[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type LeadAnalysisSummary = {
  id: string;
  potentialScore: number;
  closeProbability: number;
  grade: string;
  stars: number;
  reasons: string[];
  opportunities: string[];
  googleMapsScore: number;
  siteScore: number;
  instagramScore: number;
  generatedMessage: string;
  createdAt: string;
};

export type LeadDetail = Lead & {
  owner: {
    id: string;
    name: string | null;
    email: string | null;
  } | null;
  analysis: LeadAnalysisSummary | null;
  followUps: Array<{
    id: string;
    title: string;
    dueAt: string;
    completedAt: string | null;
    cadenceDays: number;
    notes: string | null;
  }>;
  documents: Array<{
    id: string;
    kind: string;
    status: string;
    title: string;
    value: number | null;
    deadline: string | null;
    fileUrl: string | null;
    createdAt: string;
  }>;
  sales: Array<{
    id: string;
    value: number;
    paymentMethod: string;
    commission: number | null;
    monthlyRevenue: number | null;
    profit: number | null;
    closedAt: string;
  }>;
};
