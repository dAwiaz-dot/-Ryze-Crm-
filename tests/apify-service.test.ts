import test from "node:test";
import assert from "node:assert/strict";
import { buildApifyRunInput, normalizeApifyActorId, normalizeApifyPlace } from "../services/apify.service";
import { filterLeads } from "../services/lead-filter.service";
import type { LeadSearchFilters } from "../types/lead";

const filters: LeadSearchFilters = {
  state: "MG",
  city: "Pouso Alegre",
  category: "Dentistas",
  maxResults: 7,
  minRating: 4,
  minReviews: 20,
  onlyWithoutWebsite: false,
  onlyWithPhone: true,
  onlyWithWhatsApp: false,
  ignoreDuplicates: true
};

test("normalizeApifyActorId converts store slugs to Apify API ids", () => {
  assert.equal(normalizeApifyActorId("compass/crawler-google-places"), "compass~crawler-google-places");
  assert.equal(normalizeApifyActorId("compass~crawler-google-places"), "compass~crawler-google-places");
});

test("buildApifyRunInput uses Google Maps Scraper compatible fields", () => {
  assert.deepEqual(buildApifyRunInput(filters), {
    searchString: "Dentistas em Pouso Alegre MG",
    searchStringsArray: ["Dentistas em Pouso Alegre MG"],
    maxCrawledPlaces: 7,
    maxCrawledPlacesPerSearch: 7,
    language: "pt-BR",
    skipClosedPlaces: true,
    includeWebResults: true,
    proxyConfig: {
      useApifyProxy: true
    }
  });
});

test("normalizeApifyPlace keeps requested city state and category for filtering", () => {
  const lead = normalizeApifyPlace(
    {
      title: "Clínica Real",
      phoneUnformatted: "+55 35 99999-0000",
      address: "Rua Central, 10",
      city: "",
      state: "Minas Gerais",
      categoryName: "Dentist",
      totalScore: 4.9,
      reviewsCount: 120,
      website: "",
      url: "https://maps.google.com/?cid=123",
      location: { lat: -22.22, lng: -45.45 }
    },
    filters,
    0
  );

  assert.equal(lead.city, "Pouso Alegre");
  assert.equal(lead.state, "MG");
  assert.equal(lead.category, "Dentistas");
  assert.equal(lead.website, null);
  assert.deepEqual(filterLeads([lead], { ...filters, onlyWithoutWebsite: true, onlyWithWhatsApp: true }).map((item) => item.company), ["Clínica Real"]);
});

test("normalizeApifyPlace treats social links as no own website and flags only mobiles as WhatsApp", () => {
  const instagramOnly = normalizeApifyPlace(
    { title: "Pizzaria Bella", phoneUnformatted: "+553532221234", website: "https://www.instagram.com/pizzariabella/" },
    filters,
    0
  );

  assert.equal(instagramOnly.website, null);
  assert.equal(instagramOnly.instagram, "https://www.instagram.com/pizzariabella/");
  assert.equal(instagramOnly.socialUrl, "https://www.instagram.com/pizzariabella/");
  assert.equal(instagramOnly.hasWhatsApp, false);

  const ownSite = normalizeApifyPlace(
    { title: "Clinica Beta", phoneUnformatted: "+5535988881234", website: "https://clinicabeta.com.br" },
    filters,
    1
  );

  assert.equal(ownSite.website, "https://clinicabeta.com.br");
  assert.equal(ownSite.socialUrl, null);
  assert.equal(ownSite.hasWhatsApp, true);
});
