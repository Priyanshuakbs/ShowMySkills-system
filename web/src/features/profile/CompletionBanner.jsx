"use client";

import { ArrowRight } from "lucide-react";
import {
  getCompletionBannerState,
  triggerCompletionAction,
} from "@/features/profile/profileUtils.mjs";

/**
 * CompletionBanner — Horizontal profile-completion progress bar
 * with teal fill and "Complete your profile →" link.
 */
export default function CompletionBanner({ percentage, missingFields = [], onComplete }) {
  const { percentage: safePercentage, visible } = getCompletionBannerState(percentage, missingFields);
  const handleComplete = () => triggerCompletionAction(onComplete);

  return (
    <section
      id="profile-completion-banner"
      data-testid="profile-completion-banner"
      hidden={!visible}
      aria-hidden={!visible}
      className={`${visible ? "flex" : "hidden"} flex-col bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-4 sm:flex-row items-start sm:items-center gap-3`}
    >
      {/* Label */}
      <span className="text-sm font-bold text-gray-900 whitespace-nowrap">
        {safePercentage}% Profile Complete
      </span>

      {/* Progress Track */}
      <div className="flex-1 w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-[#4B9C93] rounded-full transition-all duration-700 ease-out"
          style={{ width: `${safePercentage}%` }}
        />
      </div>

      {/* CTA */}
      <button
        type="button"
        aria-controls="profile-editor-dialog"
        onClick={handleComplete}
        className="text-sm font-semibold text-[#4B9C93] hover:text-[#3d867e] whitespace-nowrap flex items-center gap-1 transition-colors"
      >
        Complete your profile
        <ArrowRight className="w-4 h-4" />
      </button>
      {missingFields.length > 0 && (
        <p className="w-full text-xs text-gray-500 sm:pl-2">
          Still needed: {missingFields.join(", ")}
        </p>
      )}
    </section>
  );
}
