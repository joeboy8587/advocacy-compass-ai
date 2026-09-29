import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Brain, Check, HelpCircle, Loader2, ShieldQuestion, ThumbsDown, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadErrorPanel } from "@/components/LoadErrorPanel";
import {
  addInvestigatorNote,
  getAircraftDeck,
  getCaseDeck,
  recordLeadVerdict,
  clearLeadVerdict,
  type DeckLead,
  type HypothesisDeck as Deck,
  type Verdict,
} from "@/lib/intelligence.functions";

const STRENGTH_STYLE: Record<DeckLead["strength"], string> = {
  STRONG: "border-primary text-primary",
  MODERATE: "border-accent text-accent",
  WEAK: "border-border text-muted-foreground",
};

const STRENGTH_WORD: Record<DeckLead["strength"], string> = {
  STRONG: "Strong lead",
  MODERATE: "Worth a look",
  WEAK: "Thin",
};

const VERDICT_WORD: Record<Verdict, string> = {
  CONFIRMED: "You confirmed this",
  REVIEW: "You flagged this for review",
  NOT_USEFUL: "You ruled this out",
};

function when(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function HypothesisDeck({
  icao,
  caseId,
  label,
  title = "What the evidence suggests",
}: {
  icao?: string;
  caseId?: string;
  label?: string;
  title?: string;
}) {
  const queryClient = useQueryClient();
  const key = ["deck", caseId ?? "", icao ?? ""];

  const deck = useQuery<Deck>({
    queryKey: key,
    queryFn: () =>
      caseId && !icao
        ? getCaseDeck({ data: { caseId } })
        : getAircraftDeck({ data: { icao: icao as string, caseId, label } }),
    enabled: Boolean(icao || caseId),
    staleTime: 60_000,
  });

  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");

  const saveNote = useMutation({
    mutationFn: async () => {
      await addInvestigatorNote({
        data: { note: noteText, subjectIcao: icao, subjectLabel: deck.data?.label, caseId },
      });
    },
    onSuccess: () => {
      toast.success("Saved. Josiah will remember this.");
      setNoteText("");
      setNoteOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["deck"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save that note"),
  });

  if (deck.isPending) {
    return (
      <div className="panel p-4 text-xs text-muted-foreground flex items-center gap-2">
        <Loader2 className="size-3 animate-spin" /> Reading the pattern history…
      </div>
    );
  }

  if (deck.error) {
    return <LoadErrorPanel error={deck.error as Error} reset={() => void deck.refetch()} title="Leads unavailable" />;
  }

  const data = deck.data;
  if (!data) return null;

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm neon-text-orange flex items-center gap-2">
            <Brain className="size-4" /> {title}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 max-w-prose">
            These are machine-spotted leads, not findings. Nothing here counts as evidence until you mark it confirmed.
          </p>
        </div>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground shrink-0">
          {data.counts.confirmed} confirmed · {data.counts.unreviewed} new
        </span>
      </div>

      {data.leads.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nothing has been flagged for this subject yet. That is a clean record, not a missing check.
        </p>
      )}

      <div className="space-y-2">
        {data.leads.map((lead) => (
          <LeadCard
            key={lead.item_key}
            lead={lead}
            icao={icao ?? data.icaos[0]}
            label={data.label}
            caseId={caseId}
            onSaved={() => void queryClient.invalidateQueries({ queryKey: ["deck"] })}
          />
        ))}
      </div>

      <div className="border-t border-border pt-3 space-y-2">
        {!noteOpen ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setNoteOpen(true)}
            className="text-[11px] uppercase tracking-widest rounded-sm"
          >
            <StickyNote className="size-3" /> Tell Josiah something he should remember
          </Button>
        ) : (
          <div className="space-y-2">
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              rows={3}
              placeholder="e.g. This aircraft is a crop duster working the fields east of town — not surveillance."
              className="w-full bg-card border border-border rounded-sm px-2 py-2 text-[11px]"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={!noteText.trim() || saveNote.isPending}
                onClick={() => saveNote.mutate()}
                className="text-[11px] uppercase tracking-widest"
              >
                {saveNote.isPending ? <Loader2 className="animate-spin" /> : <Check />} Save to memory
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setNoteOpen(false);
                  setNoteText("");
                }}
                className="text-[11px] uppercase tracking-widest"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      {data.memory.length > 0 && (
        <div className="border-t border-border pt-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
            What Josiah already remembers
          </div>
          <ul className="space-y-1">
            {data.memory.slice(0, 6).map((m) => (
              <li key={m.id} className="text-[11px] text-muted-foreground leading-snug">
                <span className="text-accent">•</span> {m.content}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function LeadCard({
  lead,
  icao,
  label,
  caseId,
  onSaved,
}: {
  lead: DeckLead;
  icao?: string;
  label?: string;
  caseId?: string;
  onSaved: () => void;
}) {
  const [note, setNote] = useState(lead.note ?? "");
  const [showNote, setShowNote] = useState(false);

  const vote = useMutation({
    // Pressing the verdict you already chose takes it back.
    mutationFn: async (verdict: Verdict) => {
      if (lead.verdict === verdict) {
        await clearLeadVerdict({ data: { itemKind: lead.item_kind, itemKey: lead.item_key } });
        return null;
      }
      await recordLeadVerdict({
        data: {
          itemKind: lead.item_kind,
          itemKey: lead.item_key,
          itemSummary: `${lead.title} — ${lead.events.toLocaleString()} supporting events`,
          verdict,
          note,
          subjectIcao: icao,
          subjectLabel: label,
          caseId,
        },
      });
      return verdict;
    },
    onSuccess: (verdict) => {
      toast.success(
        verdict === null
          ? "Decision taken back. This is an open lead again."
          : verdict === "CONFIRMED"
            ? "Marked confirmed. Josiah will treat it as established."
            : verdict === "NOT_USEFUL"
              ? "Ruled out. Josiah will stop raising it."
              : "Flagged for review.",
      );
      onSaved();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save your decision"),
  });

  return (
    <div className={`border rounded-sm p-3 space-y-2 ${lead.verdict === "NOT_USEFUL" ? "opacity-55" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium">{lead.title}</div>
        <span
          className={`text-[9px] uppercase tracking-widest border rounded-sm px-1.5 py-0.5 shrink-0 ${STRENGTH_STYLE[lead.strength]}`}
        >
          {STRENGTH_WORD[lead.strength]}
        </span>
      </div>

      <p className="text-[11px] text-muted-foreground leading-snug">{lead.meaning}</p>

      <div className="text-[11px] text-muted-foreground">
        Seen <b className="text-foreground">{lead.events.toLocaleString()}</b> time{lead.events === 1 ? "" : "s"}
        {lead.confidence != null && <> · machine certainty {Math.round(lead.confidence * 100)}%</>}
        {lead.latest && <> · most recent {when(lead.latest)}</>}
      </div>

      {lead.detail && <p className="text-[11px] text-muted-foreground/80 leading-snug">{lead.detail}</p>}

      {lead.rule && (
        <div className="text-[10px] uppercase tracking-widest text-primary">Rule in play: {lead.rule}</div>
      )}

      {lead.verdict && (
        <div className="text-[10px] uppercase tracking-widest text-accent">
          {VERDICT_WORD[lead.verdict]} · press the same button again to take it back
        </div>
      )}

      {showNote && (
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Why? (optional, saved with your decision)"
          className="w-full bg-card border border-border rounded-sm px-2 py-1.5 text-[11px]"
        />
      )}

      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          size="sm"
          variant={lead.verdict === "CONFIRMED" ? "default" : "outline"}
          disabled={vote.isPending}
          onClick={() => vote.mutate("CONFIRMED")}
          className="text-[10px] uppercase tracking-widest rounded-sm h-7"
        >
          <Check className="size-3" /> Confirm
        </Button>
        <Button
          type="button"
          size="sm"
          variant={lead.verdict === "REVIEW" ? "default" : "outline"}
          disabled={vote.isPending}
          onClick={() => vote.mutate("REVIEW")}
          className="text-[10px] uppercase tracking-widest rounded-sm h-7"
        >
          <ShieldQuestion className="size-3" /> Needs review
        </Button>
        <Button
          type="button"
          size="sm"
          variant={lead.verdict === "NOT_USEFUL" ? "default" : "outline"}
          disabled={vote.isPending}
          onClick={() => vote.mutate("NOT_USEFUL")}
          className="text-[10px] uppercase tracking-widest rounded-sm h-7"
        >
          <ThumbsDown className="size-3" /> Not useful
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setShowNote((s) => !s)}
          className="text-[10px] uppercase tracking-widest rounded-sm h-7 text-muted-foreground"
        >
          <HelpCircle className="size-3" /> {showNote ? "Hide note" : "Add note"}
        </Button>
      </div>
    </div>
  );
}
