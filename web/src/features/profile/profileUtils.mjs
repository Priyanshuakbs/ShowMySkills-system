const hasText = (value) => typeof value === "string" && value.trim().length > 0;
const hasNamedItem = (items, field) =>
  Array.isArray(items) && items.some((item) => item && typeof item === "object" && hasText(item[field]));

/** Keep this list aligned with the student criteria in calculateProfileCompletion. */
export function getMissingStudentProfileFields(profile = {}) {
  const missing = [];
  const requireField = (isComplete, label) => {
    if (!isComplete) missing.push(label);
  };

  requireField(hasText(profile.name), "Full name");
  requireField(hasText(profile.headline), "Professional headline");
  requireField(hasText(profile.bio), "About you");
  requireField(hasText(profile.location), "Location");
  requireField(hasText(profile.profileIcon), "Profile photo");
  requireField(hasText(profile.college), "College or university");
  requireField(hasText(profile.course), "Course");
  requireField(hasText(profile.branch), "Branch");
  requireField(Number(profile.graduationYear) > 0, "Graduation year");
  requireField(
    hasNamedItem(profile.skills, "name") ||
      (Array.isArray(profile.primarySkills) && profile.primarySkills.some(hasText)),
    "At least one skill"
  );
  requireField(hasNamedItem(profile.projects, "title"), "At least one project");
  requireField(hasText(profile.resumeUrl), "Resume");
  requireField(
    hasText(profile.portfolioUrl) || hasText(profile.githubUrl) || hasText(profile.linkedinUrl),
    "Portfolio, GitHub, or LinkedIn link"
  );
  requireField(
    hasNamedItem(profile.certifications, "name") || hasNamedItem(profile.achievements, "achievement"),
    "Certification or achievement"
  );

  return missing;
}

export function triggerCompletionAction(onComplete) {
  if (typeof onComplete === "function") onComplete();
}

export function getCompletionBannerState(percentage, missingFields = []) {
  const parsedPercentage = typeof percentage === "string"
    ? Number(percentage.trim().replace(/%$/, ""))
    : Number(percentage);
  const safePercentage = Number.isFinite(parsedPercentage)
    ? Math.max(0, Math.min(100, parsedPercentage))
    : 0;
  return {
    percentage: safePercentage,
    visible: safePercentage < 100,
  };
}
