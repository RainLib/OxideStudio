import type { TransferDialogSection } from "@/features/table-transfer/model/transferDialogTypes";
import { useEffect, useRef, useState } from "react";

interface TransferSectionNavigationOptions {
  reviewReady: boolean;
}

export function useTransferSectionNavigation({
  reviewReady,
}: TransferSectionNavigationOptions) {
  const [activeSection, setActiveSection] =
    useState<TransferDialogSection>("setup");
  const setupSectionRef = useRef<HTMLElement>(null);
  const reviewSectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!reviewReady) return;
    setActiveSection("review");
    const section = reviewSectionRef.current;
    if (!section?.scrollIntoView) return;
    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    section.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "start",
    });
  }, [reviewReady]);

  const selectSection = (section: TransferDialogSection) => {
    setActiveSection(section);
    const target =
      section === "setup" ? setupSectionRef.current : reviewSectionRef.current;
    if (!target?.scrollIntoView) return;
    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    target.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "start",
    });
  };

  return {
    activeSection,
    setActiveSection,
    setupSectionRef,
    reviewSectionRef,
    selectSection,
  };
}
