"use client";

import { useRef, useState } from "react";
import { X, Plus, Trash2, Upload } from "lucide-react";
import { uploadService } from "@/services/apiClient";

const inputClass = "w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-[#4B9C93] focus:outline-none focus:ring-2 focus:ring-[#4B9C93]/15";

const toDateInput = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

const makeForm = (user) => ({
  name: user.name || "",
  headline: user.headline || "",
  bio: user.bio || "",
  location: user.location || "",
  phone: user.phone || "",
  college: user.college || "",
  course: user.course || "",
  branch: user.branch || "",
  graduationYear: user.graduationYear ? String(user.graduationYear) : "",
  experienceLevel: user.experienceLevel || "",
  openToWorkMessage: user.openToWorkMessage || "",
  portfolioUrl: user.portfolioUrl || "",
  githubUrl: user.githubUrl || "",
  linkedinUrl: user.linkedinUrl || "",
  skills: Array.isArray(user.skills) ? user.skills.map((skill) => ({
    original: typeof skill === "object" && skill ? skill : null,
    name: typeof skill === "string" ? skill : skill?.name || "",
    level: typeof skill === "object" ? skill?.level || "intermediate" : "intermediate",
  })) : [],
  projects: Array.isArray(user.projects) ? user.projects.map((project) => ({
    original: project,
    id: project?.id || "",
    title: project?.title || "",
    description: project?.description || "",
    tags: Array.isArray(project?.tags) ? project.tags.join(", ") : "",
    verified: Boolean(project?.verified),
    repoUrl: project?.repoUrl || "",
    liveUrl: project?.liveUrl || "",
  })) : [],
  certifications: Array.isArray(user.certifications) ? user.certifications.map((item) => ({
    original: item,
    name: item?.name || "",
    issuingOrganization: item?.issuingOrganization || "",
    validationDate: toDateInput(item?.validationDate),
  })) : [],
  achievements: Array.isArray(user.achievements) ? user.achievements.map((item) => ({
    original: item,
    achievement: item?.achievement || "",
    year: item?.year ? String(item.year) : "",
  })) : [],
});

const cleanRows = (items, field) => items.filter((item) => item[field]?.trim());

export default function ProfileEditor({ user, onClose, onSaved, onResumeUploaded }) {
  const [form, setForm] = useState(() => makeForm(user));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeMessage, setResumeMessage] = useState("");
  const resumeInput = useRef(null);
  const initialValue = useRef(JSON.stringify(makeForm(user)));
  const dirty = JSON.stringify(form) !== initialValue.current;

  const requestClose = () => {
    if (dirty && !window.confirm("Discard your unsaved profile changes?")) return;
    onClose();
  };

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const updateRow = (field, index, key, value) => setForm((current) => ({
    ...current,
    [field]: current[field].map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row),
  }));
  const addRow = (field, row) => setForm((current) => ({ ...current, [field]: [...current[field], row] }));
  const removeRow = (field, index) => setForm((current) => ({
    ...current,
    [field]: current[field].filter((_, rowIndex) => rowIndex !== index),
  }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    const name = form.name.trim();
    if (!name) {
      setError("Enter your full name before saving.");
      return;
    }
    const year = form.graduationYear.trim();
    if (year && (!/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > 2200)) {
      setError("Enter a valid four-digit graduation year.");
      return;
    }

    const payload = {
      name,
      headline: form.headline.trim(),
      bio: form.bio.trim(),
      location: form.location.trim(),
      ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
      college: form.college.trim(),
      course: form.course.trim(),
      branch: form.branch.trim(),
      ...(year ? { graduationYear: Number(year) } : {}),
      experienceLevel: form.experienceLevel,
      openToWorkMessage: form.openToWorkMessage.trim(),
      portfolioUrl: form.portfolioUrl.trim(),
      githubUrl: form.githubUrl.trim(),
      linkedinUrl: form.linkedinUrl.trim(),
      skills: cleanRows(form.skills, "name").map((skill) => ({
        ...(skill.original || {}),
        name: skill.name.trim(),
        level: skill.level,
      })),
      projects: cleanRows(form.projects, "title").map((project) => ({
        ...(project.original || {}),
        id: project.id,
        ...project,
        original: undefined,
        title: project.title.trim(),
        description: project.description.trim(),
        tags: project.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      })),
      certifications: cleanRows(form.certifications, "name").map((item) => ({
        ...(item.original || {}),
        name: item.name.trim(),
        issuingOrganization: item.issuingOrganization.trim(),
        validationDate: item.validationDate || null,
      })),
      achievements: cleanRows(form.achievements, "achievement").map((item) => ({
        ...(item.original || {}),
        achievement: item.achievement.trim(),
        year: item.year ? Number(item.year) : null,
      })),
    };

    setSaving(true);
    try {
      const result = await onSaved(payload);
      if (result !== false) onClose();
    } catch (saveError) {
      setError(saveError.message || "Could not save your profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleResume = async (file) => {
    if (!file) return;
    const allowedTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (!allowedTypes.includes(file.type)) {
      setResumeMessage("Choose a PDF, DOC, or DOCX file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setResumeMessage("The resume must be 10 MB or smaller.");
      return;
    }
    setResumeBusy(true);
    setResumeMessage("");
    try {
      const response = await uploadService.uploadResume(file);
      if (!response?.success || !response.data) {
        throw new Error(response?.message || "The resume could not be saved.");
      }
      setResumeMessage("Resume uploaded successfully.");
      await onResumeUploaded(response.data);
    } catch (uploadError) {
      setResumeMessage(uploadError.message || "Resume upload failed. Please try again.");
    } finally {
      setResumeBusy(false);
      if (resumeInput.current) resumeInput.current.value = "";
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-950/50 p-0 sm:p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget) requestClose();
    }}>
      <section
        role="dialog"
        aria-modal="true"
        id="profile-editor-dialog"
        aria-labelledby="profile-editor-title"
        className="flex max-h-[95vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
      >
        <header className="flex items-start justify-between border-b border-gray-100 px-5 py-4 sm:px-7">
          <div>
            <h2 id="profile-editor-title" className="text-lg font-bold text-gray-900">Edit your profile</h2>
            <p className="mt-1 text-xs text-gray-500">Update your details, skills, projects, and links.</p>
          </div>
          <button type="button" aria-label="Close profile editor" onClick={requestClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="overflow-y-auto px-5 py-5 sm:px-7">
            {error && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Full name" required><input required maxLength={100} value={form.name} onChange={(e) => update("name", e.target.value)} className={inputClass} /></Field>
              <Field label="Professional headline"><input maxLength={160} value={form.headline} onChange={(e) => update("headline", e.target.value)} className={inputClass} /></Field>
              <Field label="Phone"><input type="tel" maxLength={30} value={form.phone} onChange={(e) => update("phone", e.target.value)} className={inputClass} /></Field>
              <Field label="Location"><input maxLength={120} value={form.location} onChange={(e) => update("location", e.target.value)} className={inputClass} /></Field>
              <Field label="College / university"><input maxLength={160} value={form.college} onChange={(e) => update("college", e.target.value)} className={inputClass} /></Field>
              <Field label="Course"><input maxLength={120} value={form.course} onChange={(e) => update("course", e.target.value)} className={inputClass} /></Field>
              <Field label="Branch"><input maxLength={120} value={form.branch} onChange={(e) => update("branch", e.target.value)} className={inputClass} /></Field>
              <Field label="Graduation year"><input type="number" min="1900" max="2200" value={form.graduationYear} onChange={(e) => update("graduationYear", e.target.value)} className={inputClass} /></Field>
              <Field label="Experience level"><select value={form.experienceLevel} onChange={(e) => update("experienceLevel", e.target.value)} className={inputClass}>
                <option value="">Select level</option><option>Beginner</option><option>Intermediate</option><option>Experienced</option>
              </select></Field>
              <Field label="Open to work message"><input maxLength={160} value={form.openToWorkMessage} onChange={(e) => update("openToWorkMessage", e.target.value)} className={inputClass} /></Field>
              <Field label="Portfolio URL"><input type="url" value={form.portfolioUrl} onChange={(e) => update("portfolioUrl", e.target.value)} className={inputClass} placeholder="https://" /></Field>
              <Field label="GitHub URL"><input type="url" value={form.githubUrl} onChange={(e) => update("githubUrl", e.target.value)} className={inputClass} placeholder="https://github.com/" /></Field>
              <Field label="LinkedIn URL"><input type="url" value={form.linkedinUrl} onChange={(e) => update("linkedinUrl", e.target.value)} className={inputClass} placeholder="https://linkedin.com/in/" /></Field>
              <Field label="About you" wide><textarea rows={4} maxLength={3000} value={form.bio} onChange={(e) => update("bio", e.target.value)} className={inputClass} /></Field>
            </div>

            <section className="mt-6 border-t border-gray-100 pt-5">
              <h3 className="mb-3 text-sm font-bold text-gray-900">Skills</h3>
              {form.skills.map((skill, index) => <div key={`skill-${index}`} className="mb-2 flex gap-2">
                <input aria-label={`Skill ${index + 1}`} value={skill.name} onChange={(e) => updateRow("skills", index, "name", e.target.value)} className={inputClass} placeholder="Skill name" />
                <select aria-label={`Skill ${index + 1} level`} value={skill.level} onChange={(e) => updateRow("skills", index, "level", e.target.value)} className={`${inputClass} max-w-40`}>
                  <option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option><option value="expert">Expert</option>
                </select>
                <RemoveButton onClick={() => removeRow("skills", index)} label="Remove skill" />
              </div>)}
              <AddButton onClick={() => addRow("skills", { name: "", level: "intermediate" })}>Add skill</AddButton>
            </section>

            <section className="mt-6 border-t border-gray-100 pt-5">
              <h3 className="mb-3 text-sm font-bold text-gray-900">Projects</h3>
              {form.projects.map((project, index) => <div key={`project-${index}`} className="mb-4 grid grid-cols-1 gap-2 rounded-xl border border-gray-100 p-3 sm:grid-cols-2">
                <input aria-label={`Project ${index + 1} title`} value={project.title} onChange={(e) => updateRow("projects", index, "title", e.target.value)} className={inputClass} placeholder="Project title" />
                <input aria-label={`Project ${index + 1} tags`} value={project.tags} onChange={(e) => updateRow("projects", index, "tags", e.target.value)} className={inputClass} placeholder="Tags, separated by commas" />
                <textarea aria-label={`Project ${index + 1} description`} rows={2} value={project.description} onChange={(e) => updateRow("projects", index, "description", e.target.value)} className={`${inputClass} sm:col-span-2`} placeholder="Description" />
                <input aria-label={`Project ${index + 1} repository URL`} type="url" value={project.repoUrl} onChange={(e) => updateRow("projects", index, "repoUrl", e.target.value)} className={inputClass} placeholder="Repository URL" />
                <div className="flex gap-2"><input aria-label={`Project ${index + 1} live URL`} type="url" value={project.liveUrl} onChange={(e) => updateRow("projects", index, "liveUrl", e.target.value)} className={inputClass} placeholder="Live URL" /><RemoveButton onClick={() => removeRow("projects", index)} label="Remove project" /></div>
              </div>)}
              <AddButton onClick={() => addRow("projects", { id: "", title: "", description: "", tags: "", verified: false, repoUrl: "", liveUrl: "" })}>Add project</AddButton>
            </section>

            <section className="mt-6 border-t border-gray-100 pt-5">
              <h3 className="mb-3 text-sm font-bold text-gray-900">Certifications</h3>
              {form.certifications.map((item, index) => <div key={`cert-${index}`} className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input aria-label={`Certification ${index + 1} name`} value={item.name} onChange={(e) => updateRow("certifications", index, "name", e.target.value)} className={inputClass} placeholder="Certification" />
                <input aria-label={`Certification ${index + 1} organization`} value={item.issuingOrganization} onChange={(e) => updateRow("certifications", index, "issuingOrganization", e.target.value)} className={inputClass} placeholder="Issuing organization" />
                <div className="flex gap-2"><input aria-label={`Certification ${index + 1} date`} type="date" value={item.validationDate} onChange={(e) => updateRow("certifications", index, "validationDate", e.target.value)} className={inputClass} /><RemoveButton onClick={() => removeRow("certifications", index)} label="Remove certification" /></div>
              </div>)}
              <AddButton onClick={() => addRow("certifications", { name: "", issuingOrganization: "", validationDate: "" })}>Add certification</AddButton>
            </section>

            <section className="mt-6 border-t border-gray-100 pt-5">
              <h3 className="mb-3 text-sm font-bold text-gray-900">Achievements</h3>
              {form.achievements.map((item, index) => <div key={`achievement-${index}`} className="mb-2 flex gap-2">
                <input aria-label={`Achievement ${index + 1}`} value={item.achievement} onChange={(e) => updateRow("achievements", index, "achievement", e.target.value)} className={inputClass} placeholder="Achievement" />
                <input aria-label={`Achievement ${index + 1} year`} type="number" min="1900" max="2200" value={item.year} onChange={(e) => updateRow("achievements", index, "year", e.target.value)} className={`${inputClass} max-w-32`} placeholder="Year" />
                <RemoveButton onClick={() => removeRow("achievements", index)} label="Remove achievement" />
              </div>)}
              <AddButton onClick={() => addRow("achievements", { achievement: "", year: "" })}>Add achievement</AddButton>
            </section>

            <section className="mt-6 rounded-xl border border-gray-100 bg-gray-50 p-4">
              <h3 className="text-sm font-bold text-gray-900">Resume</h3>
              <p className="mt-1 text-xs text-gray-500">Upload a PDF, DOC, or DOCX file up to 10 MB.</p>
              <input ref={resumeInput} type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" onChange={(e) => handleResume(e.target.files?.[0])} />
              <button type="button" disabled={resumeBusy} onClick={() => resumeInput.current?.click()} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[#4B9C93] px-3 py-2 text-sm font-semibold text-[#3d867e] disabled:opacity-50">
                <Upload className="h-4 w-4" />{resumeBusy ? "Uploading…" : user.resumeUrl ? "Replace resume" : "Add resume"}
              </button>
              {resumeMessage && <p role="status" className="mt-2 text-sm text-gray-600">{resumeMessage}</p>}
            </section>
          </div>

          <footer className="flex justify-end gap-3 border-t border-gray-100 px-5 py-4 sm:px-7">
            <button type="button" onClick={requestClose} disabled={saving} className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-lg bg-[#4B9C93] px-5 py-2 text-sm font-semibold text-white hover:bg-[#3d867e] disabled:cursor-wait disabled:opacity-60">{saving ? "Saving…" : "Save changes"}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function Field({ label, required = false, wide = false, children }) {
  return <label className={`block text-xs font-semibold text-gray-700 ${wide ? "sm:col-span-2" : ""}`}>
    <span className="mb-1.5 block">{label}{required ? " *" : ""}</span>{children}
  </label>;
}

function AddButton({ onClick, children }) {
  return <button type="button" onClick={onClick} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-[#3d867e] hover:bg-[#4B9C93]/10"><Plus className="h-3.5 w-3.5" />{children}</button>;
}

function RemoveButton({ onClick, label }) {
  return <button type="button" aria-label={label} onClick={onClick} className="shrink-0 rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>;
}
