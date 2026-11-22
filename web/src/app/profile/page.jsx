"use client";

import { useState, useEffect, useCallback } from "react";
import DashboardSidebar from "@/components/DashboardSidebar";
import DashboardHeader from "@/components/DashboardHeader";
import ProfileHeader from "@/features/profile/ProfileHeader";
import CompletionBanner from "@/features/profile/CompletionBanner";
import ReputationCard from "@/features/profile/ReputationCard";
import AboutCard from "@/features/profile/AboutCard";
import SkillsCard from "@/features/profile/SkillsCard";
import ProjectsCard from "@/features/profile/ProjectsCard";
import ProfileEditor from "@/features/profile/ProfileEditor";
import { getMissingStudentProfileFields } from "@/features/profile/profileUtils.mjs";
import { authService, uploadService } from "@/services/apiClient";

function formatProfileData(u) {
  if (!u) return null;
  return {
    name: u.name || "Student Candidate",
    tag: u.roleTag || "Student",
    verified: Boolean(u.emailVerified || u.collegeIdVerified || u.verified),
    title: u.headline || u.title || "Student Developer",
    college: u.college || "",
    location: u.location || "",
    openToWorkMessage: u.openToWorkMessage || "Open to internships and full-time opportunities",
    avatarUrl: u.profileIcon || u.avatarUrl || null,
    resumeUrl: u.resumeUrl || "",
    primarySkills: Array.isArray(u.primarySkills) && u.primarySkills.length > 0
      ? u.primarySkills
      : Array.isArray(u.skills)
      ? u.skills.map((s) => (typeof s === "string" ? s : s?.name)).filter(Boolean)
      : [],
    completionPercentage: u.completionPercentage ?? 0,
    reputationScore: u.reputationScore ?? 0,
    reputationMax: 100,
    topPercentile: u.topPercentile || "Student Engineer",
    metrics: u.metrics || [],
    aboutText: u.bio || u.aboutText || "",
    skillsList: Array.isArray(u.skills) && u.skills.length > 0
      ? u.skills.map((s) => (typeof s === "string" ? { name: s, level: "advanced" } : s)).filter((s) => s?.name)
      : [],
    projectsList: Array.isArray(u.projects) && u.projects.length > 0
      ? u.projects
      : [],
  };
}

/**
 * StudentProfilePage — Fetches live student profile from MongoDB via API.
 */
export default function StudentProfilePage() {
  const [data, setData] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarFeedback, setAvatarFeedback] = useState("");
  const [resumeBusy, setResumeBusy] = useState(false);
  const [pageError, setPageError] = useState("");
  const [pageNotice, setPageNotice] = useState("");

  const loadProfile = useCallback(async () => {
    const currentUser = await authService.getCurrentUser();
    if (!currentUser) throw new Error("Your profile could not be loaded. Please sign in again.");
    setUser(currentUser);
    setData(formatProfileData(currentUser));
    return currentUser;
  }, []);

  useEffect(() => {
    let isMounted = true;
    loadProfile().catch((err) => {
      if (isMounted) setPageError(err.message || "Failed to load your profile.");
    }).finally(() => {
      if (isMounted) setLoading(false);
    });
    return () => {
      isMounted = false;
    };
  }, [loadProfile]);

  const saveProfile = async (payload) => {
    setPageError("");
    const response = await authService.updateCurrentUser(payload);
    if (!response?.success || !response.data) {
      throw new Error(response?.message || "Your profile could not be saved.");
    }
    setUser(response.data);
    setData(formatProfileData(response.data));
    setPageNotice("Profile changes saved successfully.");
    return true;
  };

  const openProfileEditor = useCallback(() => {
    setPageError("");
    setEditorOpen(true);
  }, []);

  const applyResumeUpload = (resumeData) => {
    const updated = {
      ...user,
      resumeUrl: resumeData.resumeUrl || resumeData.url || user.resumeUrl,
      ...(resumeData.completionPercentage !== undefined
        ? { completionPercentage: resumeData.completionPercentage }
        : {}),
    };
    setUser(updated);
    setData(formatProfileData(updated));
  };

  const uploadAvatar = async (file) => {
    if (!file) return;
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];
    if (!allowedTypes.includes(file.type)) {
      setAvatarFeedback("Choose a JPEG, PNG, WebP, or SVG image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarFeedback("The profile photo must be 5 MB or smaller.");
      return;
    }
    setAvatarBusy(true);
    setPageError("");
    setPageNotice("");
    setAvatarFeedback("Uploading profile photo…");
    try {
      const response = await uploadService.uploadAvatar(file);
      if (!response?.success || !response.data?.profileIcon) {
        throw new Error(response?.message || "The profile photo could not be saved.");
      }
      const updated = { ...user, profileIcon: response.data.profileIcon };
      if (response.data.completionPercentage !== undefined) {
        updated.completionPercentage = response.data.completionPercentage;
      }
      setUser(updated);
      setData(formatProfileData(updated));
      setAvatarFeedback("Profile photo updated.");
    } catch (error) {
      setAvatarFeedback(error.message || "Profile photo upload failed.");
    } finally {
      setAvatarBusy(false);
    }
  };

  const downloadResume = async () => {
    if (!user?.resumeUrl) {
      setPageError("No resume is available yet. Add one from Edit Profile.");
      return;
    }
    setResumeBusy(true);
    setPageError("");
    setPageNotice("");
    try {
      const blob = await uploadService.downloadResume(user.resumeUrl);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      const pathname = new URL(user.resumeUrl, window.location.origin).pathname;
      anchor.download = decodeURIComponent(pathname.split("/").pop()) || "resume";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
      setPageError(error.message || "Resume download failed. Please try again.");
    } finally {
      setResumeBusy(false);
    }
  };

  const missingFields = user ? getMissingStudentProfileFields(user) : [];

  return (
    <div className="min-h-screen bg-[#F7F9F9] flex">
      {/* ──── Left Sidebar ──── */}
      <DashboardSidebar />

      {/* ──── Main Content Area ──── */}
      <div className="flex-1 md:ml-[220px] ml-0 flex flex-col min-h-screen">
        {/* ──── Top Header Bar ──── */}
        <DashboardHeader />

        {/* ──── Scrollable Content ──── */}
        <main className="flex-1 overflow-y-auto px-6 sm:px-8 py-6">
          <div className="max-w-[900px] mx-auto space-y-5">
            {pageError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{pageError}</p>}
            {pageNotice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{pageNotice}</p>}
            {loading ? (
              <div className="space-y-4">
                <div className="h-44 bg-white rounded-2xl animate-pulse border border-gray-100" />
                <div className="h-16 bg-white rounded-2xl animate-pulse border border-gray-100" />
                <div className="h-40 bg-white rounded-2xl animate-pulse border border-gray-100" />
              </div>
            ) : data ? (
              <>
                {/* Profile Identity Card */}
                <ProfileHeader
                  data={data}
                  onEdit={openProfileEditor}
                  onDownloadResume={downloadResume}
                  downloadingResume={resumeBusy}
                  onAvatarFile={uploadAvatar}
                  uploadingAvatar={avatarBusy}
                  avatarFeedback={avatarFeedback}
                />

                {/* Profile Completion Progress */}
                <CompletionBanner
                  percentage={data.completionPercentage}
                  missingFields={missingFields}
                  onComplete={openProfileEditor}
                />

                {/* Skill Reputation Score */}
                <ReputationCard data={data} />

                {/* About */}
                <AboutCard text={data.aboutText} />

                {/* Skills */}
                <SkillsCard skills={data.skillsList} />

                {/* Projects */}
                <ProjectsCard projects={data.projectsList} />
              </>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center text-gray-500">
                No profile found in database.
              </div>
            )}
          </div>
        </main>
      </div>
      {editorOpen && user && (
        <ProfileEditor
          user={user}
          onClose={() => setEditorOpen(false)}
          onSaved={saveProfile}
          onResumeUploaded={applyResumeUpload}
        />
      )}
    </div>
  );
}
