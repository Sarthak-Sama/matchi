import type { Profile } from "./types";

export interface ProfileForm {
  anchor: { label: string; stationId?: string; point?: { lat: number; lon: number } } | null;
  tripsPerWeek: string;
  lateReturn: boolean;
  budget: string;
  budgetFirm: boolean;
  commuteCap: string;
  commuteCapFirm: boolean;
  layout: string;
}

export const EMPTY_FORM: ProfileForm = {
  anchor: null,
  tripsPerWeek: "5",
  lateReturn: false,
  budget: "",
  budgetFirm: true,
  commuteCap: "",
  commuteCapFirm: true,
  layout: "",
};

function positive(text: string): number | null {
  const n = Number(text);
  return text.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
}

/** Builds the Profile body for PUT /profile. Returns an error string for input that cannot be sent. */
export function buildProfile(
  form: ProfileForm,
  base?: Pick<Profile, "enoughMultipliers">,
): { ok: true; profile: Profile } | { ok: false; error: string } {
  const trips = positive(form.tripsPerWeek);
  if (form.anchor && trips === null) return { ok: false, error: "Trips per week must be a positive number." };
  if (form.budget.trim() !== "" && positive(form.budget) === null)
    return { ok: false, error: "Budget must be a positive number of yen." };
  if (form.commuteCap.trim() !== "" && positive(form.commuteCap) === null)
    return { ok: false, error: "Commute cap must be a positive number of minutes." };

  const budget = positive(form.budget);
  const cap = positive(form.commuteCap);
  const profile: Profile = {
    anchors:
      form.anchor && trips !== null
        ? [
            {
              id: "main",
              label: form.anchor.label,
              ...(form.anchor.stationId ? { stationId: form.anchor.stationId } : {}),
              ...(form.anchor.point ? { point: form.anchor.point } : {}),
              tripsPerWeek: trips,
              period: "peak",
              ...(form.lateReturn ? { lateReturn: true } : {}),
            },
          ]
        : [],
    ...(form.layout ? { layout: form.layout } : {}),
    ...(budget !== null ? { budget: { value: budget, firm: form.budgetFirm } } : {}),
    ...(cap !== null ? { commuteCap: { value: cap, firm: form.commuteCapFirm } } : {}),
    enoughMultipliers: base?.enoughMultipliers ?? {},
  };
  return { ok: true, profile };
}

/** Fills the form from a profile the server holds (e.g. after the chat set it). */
export function formFromProfile(profile: Profile): ProfileForm {
  const a = profile.anchors[0];
  return {
    anchor: a
      ? { label: a.label, ...(a.stationId ? { stationId: a.stationId } : {}), ...(a.point ? { point: a.point } : {}) }
      : null,
    tripsPerWeek: a ? String(a.tripsPerWeek) : EMPTY_FORM.tripsPerWeek,
    lateReturn: a?.lateReturn ?? false,
    budget: profile.budget ? String(profile.budget.value) : "",
    budgetFirm: profile.budget?.firm ?? true,
    commuteCap: profile.commuteCap ? String(profile.commuteCap.value) : "",
    commuteCapFirm: profile.commuteCap?.firm ?? true,
    layout: profile.layout ?? "",
  };
}
