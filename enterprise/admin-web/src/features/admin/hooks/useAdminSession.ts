import { useEffect, useState } from "react";
import {
  adminApi,
  type AdminAuditEvent,
  type AdminOverview,
} from "../../../api";
import { adminAuth } from "../../../auth";
import {
  initialAdminLocale,
  saveAdminLocale,
  translate,
  type AdminLocale,
} from "../../../i18n";
import { sectionFromHash, type AdminSection } from "../model/adminPresentation";
import { organizationId } from "../runtime/adminContext";

export function useAdminSession() {
  const [activeSection, setActiveSection] =
    useState<AdminSection>(sectionFromHash);
  const [locale, setLocale] = useState<AdminLocale>(initialAdminLocale);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [auditEvents, setAuditEvents] = useState<AdminAuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signedIn, setSignedIn] = useState(Boolean(adminAuth.accessToken()));
  const t = (key: string, variables?: Record<string, string | number>) =>
    translate(locale, key, variables);

  const refresh = async () => {
    if (!organizationId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setOverview(await adminApi.overview(organizationId));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void adminAuth
      .completeCallback()
      .then((completed) => {
        if (completed) setSignedIn(true);
        if (completed || adminAuth.accessToken()) void refresh();
      })
      .catch((callbackError) => {
        setError(
          callbackError instanceof Error
            ? callbackError.message
            : String(callbackError),
        );
      });
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    saveAdminLocale(locale);
  }, [locale]);

  useEffect(() => {
    const handleHashChange = () => setActiveSection(sectionFromHash());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const refreshAuditEvents = async () => {
    if (!organizationId) return;
    setAuditLoading(true);
    setError(null);
    try {
      const result = await adminApi.auditEvents(organizationId);
      setAuditEvents(result.events);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    if (activeSection === "audit" && signedIn && organizationId) {
      void refreshAuditEvents();
    }
  }, [activeSection, signedIn]);

  return {
    activeSection,
    locale,
    setLocale,
    overview,
    auditEvents,
    auditLoading,
    error,
    setError,
    loading,
    setLoading,
    signedIn,
    t,
    refresh,
    refreshAuditEvents,
  };
}
