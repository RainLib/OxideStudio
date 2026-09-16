import { type FormEvent } from "react";
import { adminApi } from "../../../api";
import { organizationId } from "../runtime/adminContext";

interface CreateAdminProjectActionsContext {
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  projectName: string;
  setProjectName: React.Dispatch<React.SetStateAction<string>>;
  setProjectOpen: React.Dispatch<React.SetStateAction<boolean>>;
  refresh: () => Promise<void>;
  assignmentProjectId: string;
  assignmentUserId: string;
}

export function createAdminProjectActions({
  setLoading,
  setError,
  projectName,
  setProjectName,
  setProjectOpen,
  refresh,
  assignmentProjectId,
  assignmentUserId,
}: CreateAdminProjectActionsContext) {
  const createProject = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await adminApi.createProject(organizationId, projectName);
      setProjectName("");
      setProjectOpen(false);
      await refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
      setLoading(false);
    }
  };
  const assignProject = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await adminApi.assignProject(
        organizationId,
        assignmentProjectId,
        assignmentUserId,
      );
      await refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
      setLoading(false);
    }
  };

  return { createProject, assignProject };
}
