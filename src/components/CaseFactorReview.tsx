import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Save, CheckCircle2, ArrowLeft, ArrowRight, Loader2, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getCaseById, updateCase } from "@/lib/watchtower.functions";
import { reviewFactors, assessments, dispositions, readReview, writeReview, reviewGaps, type FactorReview } from "@/lib/case-review";

export function CaseFactorReview({ caseId, notes }: { caseId: string; notes: string | null }) {
  const [review, setReview] = useState(() => readReview(notes));
  const [step, setStep] = useState(0);
  const [dirty, setDirty] = useState(false);
  const qc = useQueryClient();
  const readCase = useServerFn(getCaseById);
  const saveCase = useServerFn(updateCase);
  const gaps = reviewGaps(review);
  const factor = reviewFactors[step];
  const saved = useMutation({
    mutationFn: async (complete: boolean) => {
      if (complete && gaps.length) throw new Error("Finish the outstanding review fields before completing.");
      const current = await readCase({ data: { id: caseId } });
      if (!current) throw new Error("Case no longer available.");
      const next = { ...review, state: complete ? "reviewed" as const : "draft" as const, savedAt: new Date().toISOString() };
      const result = await saveCase({ data: { id: caseId, reviewer_notes: writeReview(current.reviewer_notes, next) } });
      if (!result.id) throw new Error("The review was not saved.");
      return next;
    },
    onSuccess: next => { setReview(next); setDirty(false); qc.invalidateQueries({ queryKey: ["case", caseId] }); },
  });
  function change(key: keyof FactorReview, value: string) {
    if (!factor) return;
    setReview(r => ({ ...r, state: "draft", factors: { ...r.factors, [factor.key]: { ...r.factors[factor.key], [key]: value } } }));
    setDirty(true);
  }
  const r = factor ? review.factors[factor.key] : null;
  return <section className="space-y-5 py-3" aria-label="Multi-factor case review">
    <header className="flex flex-wrap justify-between gap-3">
      <div><h2 className="text-lg flex items-center gap-2 text-accent"><Scale className="size-5" /> Multi-factor case review</h2>
        <p className="text-sm text-muted-foreground mt-1">Internal thread assessment · No single factor establishes proof.</p></div>
      <div role="status" className="text-xs text-muted-foreground">{dirty ? "Unsaved changes" : review.savedAt ? `${review.state === "reviewed" ? "Review completed" : "Draft saved"} · ${new Date(review.savedAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "short" })}` : "Not yet saved"}</div>
    </header>
    <nav className="flex flex-wrap gap-2" aria-label="Review factors">
      {reviewFactors.map((f, i) => <Button key={f.key} size="sm" variant={step === i ? "secondary" : "outline"} aria-current={step === i ? "step" : undefined} onClick={() => setStep(i)}>{i + 1}. {f.label}</Button>)}
      <Button size="sm" variant={step === 4 ? "secondary" : "outline"} onClick={() => setStep(4)}>5. Cross-factor assessment</Button>
    </nav>
    <fieldset disabled={saved.isPending} className="space-y-4 min-w-0">
      {factor && r ? <>
        <h3 className="font-medium">{factor.question}</h3>
        {factor.key === "squawks" && <p className="text-sm text-muted-foreground">Historical 4414/4415 reports are context, not universal FBI identifiers; shared assignments can have other explanations.</p>}
        {(factor.key === "companies" || factor.key === "addresses") && <p className="text-sm text-muted-foreground">Legitimate paperwork does not dismiss a thread. A company or address link does not establish covert activity.</p>}
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="space-y-2 text-sm block">Factor assessment<select aria-label="Factor assessment" className="block w-full h-9 bg-input border border-border rounded-md px-2" value={r.assessment} onChange={e => change("assessment", e.target.value)}>{assessments.map(a => <option key={a}>{a}</option>)}</select></label>
          <label className="space-y-2 text-sm block">Investigative relevance<select aria-label="Investigative relevance" className="block w-full h-9 bg-input border border-border rounded-md px-2" value={r.weight} onChange={e => change("weight", e.target.value)}>{["Low", "Medium", "High"].map(a => <option key={a}>{a}</option>)}</select></label>
        </div>
        <label className="block space-y-2 text-sm">Observed evidence<Textarea value={r.observation} onChange={e => change("observation", e.target.value)} rows={3} /></label>
        <label className="block space-y-2 text-sm">Source records and dates<Textarea value={r.source} onChange={e => change("source", e.target.value)} rows={2} /></label>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block space-y-2 text-sm">Alternative explanations and contrary evidence<Textarea value={r.alternative} onChange={e => change("alternative", e.target.value)} rows={3} /></label>
          <label className="block space-y-2 text-sm">Limitations and unresolved questions<Textarea value={r.gaps} onChange={e => change("gaps", e.target.value)} rows={3} /></label>
        </div>
      </> : <>
        <h3 className="font-medium">Cross-factor assessment</h3>
        <div className="divide-y divide-border">{reviewFactors.map(f => <div key={f.key} className="py-3 flex flex-wrap justify-between gap-2 text-sm"><span>{f.label}</span><span className="text-muted-foreground">{review.factors[f.key].assessment} · {review.factors[f.key].weight} relevance</span></div>)}</div>
        <label className="block space-y-2 text-sm">How the factors fit together, conflict, or share the same source<Textarea value={review.synthesis} onChange={e => { setReview(v => ({ ...v, synthesis: e.target.value, state: "draft" })); setDirty(true); }} rows={4} /></label>
        <div className="grid sm:grid-cols-2 gap-4"><label className="block space-y-2 text-sm">Thread outcome<select aria-label="Thread outcome" className="block w-full h-9 bg-input border border-border rounded-md px-2" value={review.disposition} onChange={e => { setReview(v => ({ ...v, disposition: e.target.value as typeof v.disposition, state: "draft" })); setDirty(true); }}><option value="">Select an outcome</option>{dispositions.map(d => <option key={d}>{d}</option>)}</select></label>
          <label className="block space-y-2 text-sm">Reviewer<Input value={review.reviewer} onChange={e => { setReview(v => ({ ...v, reviewer: e.target.value, state: "draft" })); setDirty(true); }} /></label></div>
        <label className="block space-y-2 text-sm">Next action and corroboration needed<Textarea value={review.nextStep} onChange={e => { setReview(v => ({ ...v, nextStep: e.target.value, state: "draft" })); setDirty(true); }} rows={3} /></label>
        {gaps.length > 0 && <p className="text-sm text-muted-foreground">Outstanding: {gaps.join(" · ")}</p>}
        <p className="text-sm text-muted-foreground">Review completion does not confirm the case, change scores, or approve public release.</p>
      </>}
    </fieldset>
    <footer className="flex flex-wrap gap-2 border-t border-border pt-4">
      <Button variant="outline" onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0}><ArrowLeft /> Back</Button>
      {step < 4 && <Button variant="outline" onClick={() => setStep(s => s + 1)}>Next <ArrowRight /></Button>}
      <Button onClick={() => saved.mutate(false)} disabled={saved.isPending}>{saved.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save draft</Button>
      {step === 4 && <Button variant="secondary" disabled={saved.isPending || gaps.length > 0} onClick={() => saved.mutate(true)}><CheckCircle2 /> Complete review</Button>}
    </footer>
    {saved.isError && <p role="alert" className="text-sm text-destructive">{saved.error.message}</p>}
  </section>;
}