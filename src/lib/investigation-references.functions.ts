import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getInvestigationReferences = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ caseId: z.string().max(100).optional(), icao: z.string().max(32).optional(), registrations: z.array(z.string().max(30)).max(40).optional(), owner: z.string().max(200).optional(), catalog: z.boolean().optional() }).parse(input))
  .handler(async ({ data }) => {
    const { readInvestigationReferences } = await import("./investigation-references.server");
    const { neonUserError } = await import("./reference-neon.server");
    try { return await readInvestigationReferences(data); }
    catch (error) { console.error("Investigation references", error); throw new Error(neonUserError(error).message); }
  });