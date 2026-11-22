const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const arrayFieldAllowLists = {
  skills: new Set(['name', 'level']),
  primarySkills: null,
  projects: new Set(['id', 'title', 'description', 'tags', 'repoUrl', 'liveUrl']),
  certifications: new Set(['name', 'issuingOrganization', 'validationDate']),
  achievements: new Set(['achievement', 'year']),
  metrics: new Set(['label', 'value', 'color']),
};

const objectFieldAllowLists = {
  companyProfile: new Set([
    'companyName', 'logo', 'tagline', 'aboutCompany', 'establishedYear',
    'industryType', 'companySize', 'website', 'linkedin', 'awards', 'certifications',
  ]),
  collegeProfile: new Set([
    'collegeName', 'aboutCollege', 'establishedYear', 'collegeType', 'pincode',
    'departments', 'courses', 'numberOfStudents', 'numberOfDepartments', 'placementRate',
    'studentsPlaced', 'companiesVisited', 'highestPackage', 'averagePackage',
    'internshipParticipation', 'website', 'linkedin',
  ]),
  notificationPreferences: new Set([
    'applicationUpdates', 'recruiterMessages', 'weeklyInternshipsDigest', 'marketingEmails',
  ]),
  privacyPreferences: new Set(['publicProfile', 'showScoresToRecruiters', 'allowDirectMessages']),
};

const companyArrayAllowLists = {
  awards: new Set(['name', 'receivedYear', 'category']),
  certifications: new Set(['name', 'issuingBody', 'validationDate']),
};

const sanitizeItems = (items, allowedFields) => {
  if (!Array.isArray(items)) return items;
  return items
    .filter(isPlainObject)
    .map((item) => Object.fromEntries(
      Object.entries(item)
        .filter(([field]) => allowedFields.has(field))
        .map(([field, value]) => [
          field,
          field === 'tags' && Array.isArray(value)
            ? value.filter((tag) => typeof tag === 'string')
            : value,
        ])
    ));
};

/** Strip unapproved and trust-bearing nested profile values from user updates. */
export const sanitizeProfileUpdate = (data) => {
  if (!isPlainObject(data)) return data;
  const sanitized = { ...data };

  // Resume references are assigned only by the authenticated upload flow.
  delete sanitized.resumeUrl;

  for (const [field, allowedFields] of Object.entries(arrayFieldAllowLists)) {
    if (data[field] === undefined) continue;
    sanitized[field] = field === 'primarySkills'
      ? (Array.isArray(data[field]) ? data[field].filter((value) => typeof value === 'string') : data[field])
      : sanitizeItems(data[field], allowedFields);
  }

  for (const [field, allowedFields] of Object.entries(objectFieldAllowLists)) {
    const value = data[field];
    if (!isPlainObject(value)) continue;
    sanitized[field] = Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => allowedFields.has(key))
        .map(([key, nestedValue]) => [
          key,
          field === 'companyProfile' && companyArrayAllowLists[key]
            ? sanitizeItems(nestedValue, companyArrayAllowLists[key])
            : ['departments', 'courses'].includes(key) && Array.isArray(nestedValue)
              ? nestedValue.filter((item) => typeof item === 'string')
              : nestedValue,
        ])
    );
  }

  return sanitized;
};
