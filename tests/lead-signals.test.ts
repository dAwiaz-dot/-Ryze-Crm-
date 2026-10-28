import test from "node:test";
import assert from "node:assert/strict";
import { classifyWebsite, isBrazilianMobile, isInstagramUrl } from "../utils/lead-signals";

test("isBrazilianMobile accepts only cell phones (DDD + 9 + 8 digits)", () => {
  assert.equal(isBrazilianMobile("+55 35 99999-0000"), true);
  assert.equal(isBrazilianMobile("(35) 98888-1234"), true);
  assert.equal(isBrazilianMobile("035 98888-1234"), true);
  assert.equal(isBrazilianMobile("(35) 3222-1234"), false);
  assert.equal(isBrazilianMobile("+55 35 3222-1234"), false);
  assert.equal(isBrazilianMobile("0800 123 4567"), false);
  assert.equal(isBrazilianMobile(null), false);
});

test("classifyWebsite separates own sites from social profiles and link aggregators", () => {
  assert.equal(classifyWebsite(null), "none");
  assert.equal(classifyWebsite(""), "none");
  assert.equal(classifyWebsite("https://www.instagram.com/clinicaalfa/"), "social");
  assert.equal(classifyWebsite("http://m.facebook.com/clinicaalfa"), "social");
  assert.equal(classifyWebsite("linktr.ee/clinicaalfa"), "social");
  assert.equal(classifyWebsite("https://wa.me/5535999990000"), "social");
  assert.equal(classifyWebsite("https://www.ifood.com.br/delivery/alfenas-mg/pizzaria"), "social");
  assert.equal(classifyWebsite("https://clinicaalfa.com.br"), "own");
  assert.equal(classifyWebsite("https://instagram-clinica.com.br"), "own");
});

test("isInstagramUrl detects Instagram profile links", () => {
  assert.equal(isInstagramUrl("https://www.instagram.com/clinicaalfa/"), true);
  assert.equal(isInstagramUrl("https://facebook.com/clinicaalfa"), false);
});
