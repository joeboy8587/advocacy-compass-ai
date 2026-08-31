// Josiah co-pilot: persistent threads, persistent memory, data-aware answers.
import { createServerFn } from "@tanstack/react-start";

const MODEL = "google/gemini-3-flash-preview";

export type JosiahThread = {
  id: string;
  title: string;
  case_id: string | null;
  mode: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
};

export type JosiahMessage = {
  id: string;
  thread_id: string;
  role: "user" | "assistant";
  content: string;
  mode: string | null;
  provider: string | null;
  created_at: string;
};

export type JosiahMemoryRow = {
  id: number;
  category: string;
  content: string;
  source: string | null;
  case_id: string | null;
  importance: number | null;
  timestamp: string;
};

// ---------- Threads ----------
export const listThreads = createServerFn({ method: "GET" }).handler(async () => {
  const { neonQuery } = await import("./neon.server");
  return neonQuery<JosiahThread>(
    `SELECT t.id::text, t.title, t.case_id, t.mode, t.created_at::text, t.updated_at::text,
            (SELECT count(*)::int FROM josiah_messages m WHERE m.thread_id = t.id) AS message_count
     FROM josiah_threads t ORDER BY t.updated_at DESC LIMIT 100`,
  );
});

export const createThread = createServerFn({ method: "POST" })
  .inputValidator((d: { title?: string; caseId?: string | null; mode?: string } | undefined) => d ?? {})
  .handler(async ({ data }) => {
    const { neonQuery } = await import("./neon.server");
    const rows = await neonQuery<{ id: string }>(
      `INSERT INTO josiah_threads (title, case_id, mode) VALUES ($1, $2, $3) RETURNING id::text`,
      [data.title?.trim() || "New investigation", data.caseId || null, data.mode || "AUTO"],
    );
    return { ok: true as const, id: rows[0].id };
  });

export const deleteThread = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => {
    if (!d?.id) throw new Error("id required");
    return d;
  })
  .handler(async ({ data }) => {
    const { neonQuery } = await import("./neon.server");
    await neonQuery(`DELETE FROM josiah_threads WHERE id = $1::uuid`, [data.id]);
    return { ok: true as const };
  });

export const getThread = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => {
    if (!d?.id) throw new Error("id required");
    return d;
  })
  .handler(async ({ data }) => {
    const { neonQuery } = await import("./neon.server");
    const [threads, messages] = await Promise.all([
      neonQuery<JosiahThread>(
        `SELECT id::text, title, case_id, mode, created_at::text, updated_at::text
         FROM josiah_threads WHERE id = $1::uuid`,
        [data.id],
      ),
      neonQuery<JosiahMessage>(
        `SELECT id::text, thread_id::text, role, content, mode, provider, created_at::text
         FROM josiah_messages WHERE thread_id = $1::uuid ORDER BY created_at ASC`,
        [data.id],
      ),
    ]);
    return { thread: threads[0] ?? null, messages };
  });

export const updateThread = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; title?: string; caseId?: string | null }) => {
    if (!d?.id) throw new Error("id required");
    return d;
  })
  .handler(async ({ data }) => {
    const { neonQuery } = await import("./neon.server");
    await neonQuery(
      `UPDATE josiah_threads
       SET title = COALESCE($2, title), case_id = COALESCE($3, case_id), updated_at = now()
       WHERE id = $1::uuid`,
      [data.id, data.title ?? null, data.caseId ?? null],
    );
    return { ok: true as const };
  });

// ---------- Memory ----------
export const listMemory = createServerFn({ method: "GET" })
  .inputValidator((d: { caseId?: string | null } | undefined) => d ?? {})
  .handler(async ({ data }) => {
    const { neonQuery } = await import("./neon.server");
    return neonQuery<JosiahMemoryRow>(
      `SELECT id, category, content, source, case_id, importance, timestamp
       FROM josiah_memory
       ${data.caseId ? "WHERE case_id IS NULL OR case_id = $1" : ""}
       ORDER BY importance DESC NULLS LAST, id DESC LIMIT 100`,
      data.caseId ? [data.caseId] : [],
    );
  });

export const addMemory = createServerFn({ method: "POST" })
  .inputValidator((d: { content: string; category?: string; caseId?: string | null; importance?: number }) => {
    if (!d?.content?.trim()) throw new Error("content required");
    return d;
  })
  .handler(async ({ data }) => {
    const { neonQuery } = await import("./neon.server");
    await neonQuery(
      `INSERT INTO josiah_memory (category, content, source, case_id, importance, timestamp)
       VALUES ($1, $2, 'Operator', $3, $4, to_char(now(),'YYYY-MM-DD HH24:MI'))`,
      [data.category ?? "RULE", data.content.trim(), data.caseId ?? null, data.importance ?? 4],
    );
    return { ok: true as const };
  });

export const deleteMemory = createServerFn({ method: "POST" })
  .inputValidator((d: { id: number }) => {
    if (!d?.id) throw new Error("id required");
    return d;
  })
  .handler(async ({ data }) => {
    const { neonQuery } = await import("./neon.server");
    await neonQuery(`DELETE FROM josiah_memory WHERE id = $1`, [data.id]);
    return { ok: true as const };
  });

// ---------- The co-pilot turn ----------
export const sendJosiahMessage = createServerFn({ method: "POST" })
  .inputValidator((d: { threadId: string; question: string; mode?: "LEGAL" | "SNARK" | "AUTO" }) => {
    if (!d?.threadId) throw new Error("threadId required");
    if (!d?.question?.trim()) throw new Error("question required");
    return d;
  })
  .handler(async ({ data }) => {
    if (!process.env.NVIDIA_NIM_API_KEY && !process.env.LOVABLE_API_KEY && !process.env.OPENAI_API_KEY) {
      throw new Error("No AI key configured (NVIDIA_NIM_API_KEY, LOVABLE_API_KEY or OPENAI_API_KEY)");
    }
    const { neonQuery } = await import("./neon.server");
    const { selectMode, systemFor } = await import("./josiah-prompts");

    const threads = await neonQuery<{ case_id: string | null; title: string; mode: string }>(
      `SELECT case_id, title, mode FROM josiah_threads WHERE id = $1::uuid`,
      [data.threadId],
    );
    if (!threads[0]) return { ok: false as const, error: "Thread not found" };
    const thread = threads[0];

    const requested = data.mode && data.mode !== "AUTO" ? data.mode : undefined;
    const mode = requested ?? selectMode(data.question);

    // Persist the operator turn first so nothing is lost if the model fails.
    await neonQuery(
      `INSERT INTO josiah_messages (thread_id, role, content) VALUES ($1::uuid, 'user', $2)`,
      [data.threadId, data.question],
    );

    const [history, memory] = await Promise.all([
      neonQuery<{ role: string; content: string }>(
        `SELECT role, content FROM josiah_messages
         WHERE thread_id = $1::uuid ORDER BY created_at DESC LIMIT 24`,
        [data.threadId],
      ),
      neonQuery<JosiahMemoryRow>(
        `SELECT id, category, content, case_id, importance FROM josiah_memory
         WHERE case_id IS NULL OR case_id = $1
         ORDER BY importance DESC NULLS LAST, id DESC LIMIT 40`,
        [thread.case_id],
      ),
    ]);
    history.reverse();

    const { gatherContext, gatherCaseContext, gatherEvidenceContext, gatherLegalExposure } =
      await import("./josiah-context.server");
    const [context, caseCtx, evidenceCtx, legalCtx] = await Promise.all([
      gatherContext(),
      thread.case_id ? gatherCaseContext(thread.case_id) : Promise.resolve(""),
      gatherEvidenceContext(data.question).catch(() => ""),
      gatherLegalExposure().catch(() => ""),
    ]);


    let osint = "";
    if (thread.case_id) {
      try {
        const { fetchOsintContextForCase } = await import("./osint.functions");
        const o = await fetchOsintContextForCase(thread.case_id);
        if (o) osint = `\n\n## OSINT Findings\n${o}`;
      } catch {
        /* non-fatal */
      }
    }

    let doctrine = "";
    try {
      const { fetchDoctrineContext } = await import("./doctrine.functions");
      doctrine = (await fetchDoctrineContext(data.question, 3)) ?? "";
    } catch {
      /* non-fatal */
    }

    const memoryBlock = memory.length
      ? memory.map((m) => `- [${m.category}] ${m.content}`).join("\n")
      : "- (no persistent facts recorded yet)";

    const system = `${systemFor(mode, true)}

# PERSISTENT MEMORY (established facts — already known, do not re-derive)
${memoryBlock}

# LIVE CORPUS CONTEXT
${context}${caseCtx ? `\n\n${caseCtx}` : ""}${osint}${doctrine ? `\n\n# Doctrine Library\n${doctrine}` : ""}${evidenceCtx ? `\n\n# Evidence Corpus\n${evidenceCtx}` : ""}${legalCtx ? `\n\n# Legal Exposure\n${legalCtx}` : ""}`;

    const messages = history
      .slice(-24)
      .map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), content: m.content }));

    try {
      const { generateTextWithFallback } = await import("./ai-fallback.server");
      const { text, provider } = await generateTextWithFallback({ model: MODEL, system, messages });

      // Harvest ```memory``` blocks into persistent memory, then strip them.
      const facts: Array<{ category: string; content: string }> = [];
      const clean = text.replace(/```memory\s*([\s\S]*?)```/g, (_m, body: string) => {
        for (const line of body.split("\n")) {
          const t = line.trim();
          if (!t) continue;
          const [cat, ...rest] = t.split("|");
          const content = rest.join("|").trim() || cat.trim();
          const category = rest.length ? cat.trim().toUpperCase().slice(0, 40) : "PATTERN";
          if (content.length > 3) facts.push({ category, content });
        }
        return "";
      }).trim();

      for (const f of facts.slice(0, 3)) {
        await neonQuery(
          `INSERT INTO josiah_memory (category, content, source, case_id, importance, timestamp)
           VALUES ($1, $2, 'Josiah Thread', $3, 3, to_char(now(),'YYYY-MM-DD HH24:MI'))`,
          [f.category, f.content, thread.case_id],
        ).catch(() => undefined);
      }

      await neonQuery(
        `INSERT INTO josiah_messages (thread_id, role, content, mode, provider)
         VALUES ($1::uuid, 'assistant', $2, $3, $4)`,
        [data.threadId, clean, mode, provider],
      );

      // Auto-title a fresh thread from the first question.
      if (thread.title === "New investigation") {
        await neonQuery(`UPDATE josiah_threads SET title = $2 WHERE id = $1::uuid`, [
          data.threadId,
          data.question.replace(/\[(LEGAL|SNARK)\]/gi, "").trim().slice(0, 70),
        ]);
      }
      await neonQuery(`UPDATE josiah_threads SET updated_at = now() WHERE id = $1::uuid`, [data.threadId]);

      return { ok: true as const, text: clean, mode, provider, memorized: facts.length };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message ?? "AI gateway error", mode };
    }
  });
