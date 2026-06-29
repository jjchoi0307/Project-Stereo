import Link from "next/link";
import { notFound } from "next/navigation";
import VerifyBadge from "@/components/VerifyBadge";
import Header from "@/components/ui/Header";
import Stepper from "@/components/ui/Stepper";
import { getAuditStore } from "@/lib/audit/store";
import { getDataStore } from "@/lib/data";
import { getIntakeReference } from "@/lib/intake/reference";
import { CONDITION_OPTIONS } from "@/lib/intake/options";
import type { ExclusionReason, NormalizedProfile, RiskBand } from "@/lib/domain";
import { clientRef } from "@/lib/session/ref";

export const dynamic = "force-dynamic";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const RULE_LABEL: Record<ExclusionReason, string> = {
  provider_out_of_network: "NETWORK_REQUIRED",
  medication_off_formulary: "DRUG_FORMULARY",
  region_unavailable: "REGION_UNAVAILABLE",
  snp_ineligible: "SNP_INELIGIBLE",
};

const MARKER_LABEL: Record<keyof Omit<NormalizedProfile, "profileId">, string> = {
  diabetes: "Diabetes / metabolic",
  networkSensitivity: "Network sensitivity",
  specialistNeed: "Specialist need",
  drugUtilizationIntensity: "Drug utilization",
  mentalHealthUtilization: "Mental health",
  oncologyRisk: "Oncology",
};
const BAND_TEXT: Record<RiskBand, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  very_high: "Very high",
};

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await (await getAuditStore()).get(id);
  if (!record) notFound();

  const [plans, reference] = await Promise.all([getDataStore().listPlans(), getIntakeReference()]);
  const planName = new Map(plans.map((p) => [p.id, p.name]));
  const name = (pid: string) => planName.get(pid) ?? pid;
  const p = record.profileSnapshot;
  const n = record.normalizedProfile;

  const regionName = reference.regions.find((r) => r.id === p.marketRegion)?.name ?? p.marketRegion;
  const condLabel = (c: string) => CONDITION_OPTIONS.find((o) => o.value === c)?.label ?? c;
  const conditions = p.conditions.map(condLabel).join(", ") || "—";
  const requiredProviders = p.providerConstraints.map((c) => c.label).join(", ") || "None";
  // The delivered top pick is the AI recommendation's (what the member saw), not
  // the legacy deterministic ranking.
  const topId = record.aiRecommendation?.topPlanId ?? record.ranking[0];
  const seedHex = "0x" + (record.scenarioSeed >>> 0).toString(16).toUpperCase();
  const excluded = record.exclusionLog.filter((e) => e.severity === "exclude");
  // Session id underlying this record's profile snapshot (file already maps `profile-<id>`).
  const sessionId = p.id.replace(/^profile-/, "");

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-[840px] px-6 pb-14 pt-7" data-fade>
        <Link href="/audit" className="lk mb-3.5 inline-block text-[13px]">
          ← Audit log
        </Link>

        <Stepper
          current={3}
          steps={[
            { label: "Capture facts", href: `/session/${sessionId}` },
            { label: "Clinical read", href: `/session/${sessionId}` },
            { label: "Recommendation", href: `/session/${sessionId}/recommendation` },
            { label: "On record" },
          ]}
        />

        {/* Certificate of record — hairline frame, sealed and re-verifiable. */}
        <div className="record">
          <div className="border-b border-line px-[22px] py-5">
            <div className="mb-1.5 flex items-center gap-2.5">
              <div className="eyebrow text-accent">Certificate of record · immutable</div>
              <span className="border border-line px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.04em] text-ink2">
                Immutable
              </span>
            </div>
            <h1 className="num m-0 text-[21px] font-semibold text-accent">{record.id}</h1>
            <p className="mt-1 text-[13px] leading-[1.5] text-ink2">
              Client <span className="num font-semibold text-ink">{clientRef(p.id.replace(/^profile-/, ""))}</span> ·{" "}
              <span className="num">{fmtDate(record.createdAt)}</span> · recommended{" "}
              <strong className="display font-semibold text-ink">{topId ? name(topId) : "—"}</strong>
            </p>
          </div>

          {/* Verify — the trust centerpiece carrying the verification seal. */}
          <div className="flex flex-wrap items-center gap-[18px] px-[22px] py-5">
            <div className="min-w-[220px] flex-1">
              <div className="eyebrow mb-1 text-ink2">Verify reproducibility</div>
              <p className="m-0 text-[12.5px] leading-[1.5] text-ink2">
                {record.aiRecommendation
                  ? "The delivered AI recommendation is preserved verbatim below — every figure cited to a plan PDF + page (reproducibility by record). Verify re-runs the deterministic eligibility gate against the recorded versions and confirms it's unchanged."
                  : "Re-runs the engine with the recorded seed and versions, then confirms the ranking reproduces exactly."}
              </p>
            </div>
            <VerifyBadge auditId={record.id} />
          </div>

          {/* Monospace provenance footer — engine/data versions · seed · futures · id. */}
          <div className="num flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-paper px-[22px] py-3 text-[11px] text-ink2">
            <span>engine {record.engineVersion ?? "—"}</span>
            <span className="text-line">·</span>
            <span>data {record.dataVersion ?? "—"}</span>
            <span className="text-line">·</span>
            <span>seed {seedHex}</span>
            <span className="text-line">·</span>
            <span>{record.scenarioCount} futures</span>
            <span className="text-line">·</span>
            <span>{record.id}</span>
          </div>
        </div>
        <div className="h-5" />

        {/* AI recommendation (delivered) */}
        {record.aiRecommendation && (
          <Card title={`AI recommendation (delivered) · ${record.aiRecommendation.model}`}>
            <p className="mb-3 text-[12px] leading-[1.5] text-ink2">
              The exact recommendation the member was shown, grounded in the 2026 plan files. Top pick:{" "}
              <strong className="display text-ink">
                {record.aiRecommendation.topPlanId ? name(record.aiRecommendation.topPlanId) : "—"}
              </strong>
              .
            </p>
            <div className="flex flex-col">
              {record.aiRecommendation.ranked.slice(0, 5).map((r, i) => (
                <div key={r.planId} className="border-t border-line py-3.5 first:border-t-0 first:pt-0">
                  <div className="mb-1 flex items-center gap-2.5">
                    <span className="num text-[15px] font-semibold text-ink2">{String(i + 1).padStart(2, "0")}</span>
                    <span className="display text-[15px] font-semibold text-ink">{r.planName}</span>
                    <span className="num ml-auto font-semibold text-accent">{r.fitScore}</span>
                  </div>
                  <ul className="flex flex-col gap-1">
                    {r.reasons.map((reason, j) => (
                      <li key={j} className="flex gap-2 text-[11.5px] leading-[1.45] text-ink2">
                        <span className={reason.positive ? "text-pos" : "text-warn"}>
                          {reason.positive ? "✓" : "⚑"}
                        </span>
                        <span>
                          {reason.text}
                          {reason.citation && (
                            <span className="num ml-1 text-prov">
                              [{reason.citation.sourceFile}
                              {reason.citation.sourcePage ? ` p.${reason.citation.sourcePage}` : ""}: “
                              {reason.citation.quote}”]
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Snapshot grid */}
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SnapshotCard title="Profile snapshot">
            <KV k="Age / region" v={`${p.age} · ${regionName}`} />
            <KV k="Conditions" v={conditions} />
            <KV k="Medications" v={`${p.medications.length} captured`} />
            <KV k="Required provider" v={requiredProviders} />
          </SnapshotCard>
          <SnapshotCard title="Versions & seed">
            <KV k="Plan data" v={record.dataVersion ?? "—"} mono />
            <KV k="Engine" v={record.engineVersion ?? "—"} mono />
            <KV k="Random seed" v={seedHex} mono />
            <KV k="Futures" v={String(record.scenarioCount)} mono />
          </SnapshotCard>
        </div>

        {/* Normalized markers */}
        <Card title="Normalized markers">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(MARKER_LABEL) as (keyof typeof MARKER_LABEL)[]).map((k) => (
              <span
                key={k}
                className="border border-line bg-paper px-2.5 py-[5px] text-xs text-ink2"
              >
                {MARKER_LABEL[k]} · <span className="num font-semibold text-ink">{Math.round(n[k].value * 100)}</span>{" "}
                <span className="text-ink2">{BAND_TEXT[n[k].band]}</span>
              </span>
            ))}
          </div>
        </Card>

        {/* Exclusion log */}
        <Card title="Exclusion log">
          {excluded.length === 0 ? (
            <p className="text-sm text-ink2">No plans excluded for this profile.</p>
          ) : (
            <div className="flex flex-col">
              {excluded.map((e, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 border-t border-line py-[9px] text-[12.5px] first:border-t-0 first:pt-0"
                >
                  <span className="num flex-[0_0_170px] font-medium text-neg">{RULE_LABEL[e.reason]}</span>
                  <span className="display flex-[0_0_180px] font-semibold text-ink">{name(e.planId)}</span>
                  <span className="flex-1 text-ink2">{e.detail}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

      </main>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="record mb-4 p-[18px]">
      <div className="eyebrow mb-3 text-ink2">{title}</div>
      {children}
    </section>
  );
}

function SnapshotCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="record p-[18px]">
      <div className="eyebrow mb-3 text-ink2">{title}</div>
      <div className="flex flex-col gap-[7px] text-[12.5px]">{children}</div>
    </div>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-ink2">{k}</span>
      <span className={`text-right text-ink ${mono ? "num" : ""}`}>{v}</span>
    </div>
  );
}
