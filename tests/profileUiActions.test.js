import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  getCompletionBannerState,
  getMissingStudentProfileFields,
  triggerCompletionAction,
} from "../web/src/features/profile/profileUtils.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("profile page wires edit, authenticated download, avatar upload, and completion actions", async () => {
  const page = await read("../web/src/app/profile/page.jsx");
  const header = await read("../web/src/features/profile/ProfileHeader.jsx");
  const banner = await read("../web/src/features/profile/CompletionBanner.jsx");
  const editor = await read("../web/src/features/profile/ProfileEditor.jsx");

  assert.match(page, /onEdit=\{openProfileEditor\}/);
  assert.match(page, /onDownloadResume=\{downloadResume\}/);
  assert.match(page, /onAvatarFile=\{uploadAvatar\}/);
  assert.match(page, /const openProfileEditor = useCallback\(\(\) =>/);
  assert.match(page, /onComplete=\{openProfileEditor\}/);
  assert.match(header, /onClick=\{onEdit\}/);
  assert.match(header, /onClick=\{onDownloadResume\}/);
  assert.match(header, /data\.resumeUrl \? \(/);
  assert.match(header, /onChange=\{\(event\) =>/);
  assert.match(banner, /onClick=\{handleComplete\}/);
  assert.match(banner, /triggerCompletionAction\(onComplete\)/);
  assert.match(banner, /getCompletionBannerState\(percentage, missingFields\)/);
  assert.match(banner, /hidden=\{!visible\}/);
  assert.match(banner, /aria-hidden=\{!visible\}/);
  assert.match(banner, /visible \? "flex" : "hidden"/);
  assert.match(banner, /\{safePercentage\}% Profile Complete/);
  assert.match(editor, /onSubmit=\{handleSubmit\}/);
  assert.match(editor, /await onSaved\(payload\)/);
  assert.match(editor, /await uploadService\.uploadResume\(file\)/);
  assert.match(editor, /window\.confirm\("Discard your unsaved profile changes\?/);
  assert.match(page, /setData\(formatProfileData\(response\.data\)\)/);
});

test("completion banner is visible and displays 90 percent", () => {
  const state = getCompletionBannerState(90);
  assert.deepEqual(state, { percentage: 90, visible: true });
});

test("completion banner remains visible for every incomplete percentage", () => {
  for (const percentage of [0, 1, 50, 99]) {
    assert.equal(getCompletionBannerState(percentage).visible, true, `${percentage}% should be visible`);
  }
});

test("completion banner is hidden at 100 percent even if missing fields are reported", () => {
  assert.deepEqual(getCompletionBannerState(100), { percentage: 100, visible: false });
  assert.deepEqual(getCompletionBannerState(100, ["Resume"]), { percentage: 100, visible: false });
  assert.deepEqual(getCompletionBannerState(99, ["Resume"]), { percentage: 99, visible: true });
});

test("clicking the completion action invokes the editor-opening callback", async () => {
  const page = await read("../web/src/app/profile/page.jsx");
  const banner = await read("../web/src/features/profile/CompletionBanner.jsx");
  let editorOpen = false;
  const openProfileEditor = () => { editorOpen = true; };

  triggerCompletionAction(openProfileEditor);

  assert.equal(editorOpen, true);
  assert.match(page, /onComplete=\{openProfileEditor\}/);
  assert.match(banner, /onClick=\{handleComplete\}/);
});

test("completion helper reports fields missing under the backend student policy", () => {
  const missing = getMissingStudentProfileFields({ name: "Student", headline: "Engineer" });
  assert.deepEqual(missing, [
    "About you",
    "Location",
    "Profile photo",
    "College or university",
    "Course",
    "Branch",
    "Graduation year",
    "At least one skill",
    "At least one project",
    "Resume",
    "Portfolio, GitHub, or LinkedIn link",
    "Certification or achievement",
  ]);

  const complete = getMissingStudentProfileFields({
    name: "Student",
    headline: "Engineer",
    bio: "About",
    location: "City",
    profileIcon: "/avatar.png",
    college: "College",
    course: "BSc",
    branch: "CS",
    graduationYear: 2027,
    skills: [{ name: "JavaScript" }],
    projects: [{ title: "App" }],
    resumeUrl: "/uploads/resumes/student.pdf",
    githubUrl: "https://github.com/student",
    certifications: [{ name: "Certificate" }],
  });
  assert.deepEqual(complete, []);
});
