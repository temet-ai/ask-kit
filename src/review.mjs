// A script may finish successfully while its result still needs checking. Keep only its
// explicit review verdict and bounded explanations, even when full trajectories are off.
export const REVIEW_META = "ask-kit/reviews";

export function reviewOf(value) {
  const review = value?.review;
  if (!review || !["pass", "needs_review", "unverified"].includes(review.status)) return null;
  const short = (v) => typeof v === "string" ? v.slice(0, 300) : null;
  const warnings = (Array.isArray(review.warnings) ? review.warnings : []).map(short).filter(Boolean).slice(0, 8);
  return { status: review.status, ...(warnings.length ? { warnings } : {}), ...(short(review.notes) ? { notes: short(review.notes) } : {}) };
}
