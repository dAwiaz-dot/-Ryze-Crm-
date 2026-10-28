import { PrismaClient } from "@prisma/client";
import { classifyWebsite, isBrazilianMobile, isInstagramUrl } from "../utils/lead-signals";

// Reaplica nos leads ja salvos as regras novas de WhatsApp (so celular) e site
// (Instagram/Facebook/Linktree no campo site = sem site proprio).
// Roda em modo simulacao por padrao; passe --apply para gravar.
const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

async function main() {
  const leads = await prisma.lead.findMany({
    select: { id: true, phone: true, website: true, instagram: true, hasWhatsApp: true }
  });

  let whatsappChanged = 0;
  let websiteChanged = 0;

  for (const lead of leads) {
    const hasWhatsApp = isBrazilianMobile(lead.phone);
    const socialWebsite = classifyWebsite(lead.website) === "social";
    const data: { hasWhatsApp?: boolean; website?: null; instagram?: string } = {};

    if (hasWhatsApp !== lead.hasWhatsApp) {
      data.hasWhatsApp = hasWhatsApp;
      whatsappChanged += 1;
    }

    if (socialWebsite) {
      data.website = null;
      if (!lead.instagram && isInstagramUrl(lead.website)) data.instagram = lead.website!;
      websiteChanged += 1;
    }

    if (apply && Object.keys(data).length > 0) {
      await prisma.lead.update({ where: { id: lead.id }, data });
    }
  }

  console.log(`${leads.length} leads analisados.`);
  console.log(`WhatsApp corrigido em ${whatsappChanged} leads (fixo deixa de contar como WhatsApp).`);
  console.log(`${websiteChanged} leads tinham rede social no campo site e passam a contar como sem site proprio.`);
  console.log(apply ? "Alteracoes gravadas." : "Simulacao: nada foi gravado. Rode com --apply para aplicar.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
