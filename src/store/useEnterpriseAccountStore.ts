import { create } from "zustand";
import {
  enterpriseService,
  type EnterpriseAccountStatus,
  type EnterprisePublicConfig,
} from "@/services/tauri/enterprise.service";

const ANONYMOUS_STATUS: EnterpriseAccountStatus = {
  configured: false,
  state: "anonymous",
  user: null,
  memberships: [],
  managedProjects: [],
  syncError: null,
};

interface EnterpriseAccountState {
  status: EnterpriseAccountStatus;
  isRestoring: boolean;
  isSigningIn: boolean;
  isSyncing: boolean;
  error: string | null;
  restore: () => Promise<EnterpriseAccountStatus>;
  configure: (
    config: EnterprisePublicConfig,
  ) => Promise<EnterpriseAccountStatus>;
  signIn: () => Promise<EnterpriseAccountStatus>;
  sync: () => Promise<EnterpriseAccountStatus>;
  signOut: () => Promise<EnterpriseAccountStatus>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export const useEnterpriseAccountStore = create<EnterpriseAccountState>(
  (set) => ({
    status: ANONYMOUS_STATUS,
    isRestoring: false,
    isSigningIn: false,
    isSyncing: false,
    error: null,

    restore: async () => {
      set({ isRestoring: true, error: null });
      try {
        const status = await enterpriseService.getStatus();
        set({ status, error: status.syncError || null });
        return status;
      } catch (error) {
        set({ error: errorMessage(error) });
        throw error;
      } finally {
        set({ isRestoring: false });
      }
    },

    configure: async (config) => {
      set({ isSigningIn: true, error: null });
      try {
        const status = await enterpriseService.configure(config);
        set({ status });
        return status;
      } catch (error) {
        set({ error: errorMessage(error) });
        throw error;
      } finally {
        set({ isSigningIn: false });
      }
    },

    signIn: async () => {
      set({ isSigningIn: true, error: null });
      try {
        const status = await enterpriseService.signIn();
        set({ status, error: status.syncError || null });
        return status;
      } catch (error) {
        set({ error: errorMessage(error) });
        throw error;
      } finally {
        set({ isSigningIn: false });
      }
    },

    sync: async () => {
      set({ isSyncing: true, error: null });
      try {
        const status = await enterpriseService.syncProjects();
        set({ status, error: status.syncError || null });
        return status;
      } catch (error) {
        set({ error: errorMessage(error) });
        throw error;
      } finally {
        set({ isSyncing: false });
      }
    },

    signOut: async () => {
      set({ isSigningIn: true, error: null });
      try {
        const status = await enterpriseService.signOut();
        set({ status });
        return status;
      } catch (error) {
        set({ error: errorMessage(error) });
        throw error;
      } finally {
        set({ isSigningIn: false });
      }
    },
  }),
);
