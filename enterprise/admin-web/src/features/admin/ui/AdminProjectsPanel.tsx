import { Plus } from "lucide-react";
import type { AdminOverview } from "../../../api";
import type { AdminSection } from "../model/adminPresentation";
import { SectionHeading } from "./SectionHeading";

interface AdminProjectsPanelContext {
  activeSection: AdminSection;
  t: (
    key: string,
    variables?: Record<string, string | number> | undefined,
  ) => string;
  setProjectOpen: React.Dispatch<React.SetStateAction<boolean>>;
  projectOpen: boolean;
  createProject: (event: React.FormEvent<Element>) => Promise<void>;
  projectName: string;
  setProjectName: React.Dispatch<React.SetStateAction<string>>;
  loading: boolean;
  overview: AdminOverview | null;
  assignProject: (event: React.FormEvent<Element>) => Promise<void>;
  assignmentProjectId: string;
  setAssignmentProjectId: React.Dispatch<React.SetStateAction<string>>;
  assignmentUserId: string;
  setAssignmentUserId: React.Dispatch<React.SetStateAction<string>>;
}

export function AdminProjectsPanel({
  activeSection,
  t,
  setProjectOpen,
  projectOpen,
  createProject,
  projectName,
  setProjectName,
  loading,
  overview,
  assignProject,
  assignmentProjectId,
  setAssignmentProjectId,
  assignmentUserId,
  setAssignmentUserId,
}: AdminProjectsPanelContext) {
  return (
    <section className="module-pane" hidden={activeSection !== "projects"}>
      <SectionHeading
        title={t("Managed projects")}
        detail={t("Project assignments determine what members can discover.")}
        action={
          <button
            className="primary-button"
            onClick={() => setProjectOpen((value) => !value)}
          >
            <Plus size={14} /> {t("New project")}
          </button>
        }
      />
      {projectOpen && (
        <form className="inline-form" onSubmit={createProject}>
          <label>
            {t("Project name")}
            <input
              required
              maxLength={128}
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
            />
          </label>
          <button className="primary-button" disabled={loading}>
            {t("Create project")}
          </button>
        </form>
      )}
      <div className="table">
        <div className="table-row table-head">
          <span>{t("Project")}</span>
          <span>{t("Data sources")}</span>
          <span>{t("Members")}</span>
          <span>{t("Policy revision")}</span>
        </div>
        {overview?.projects.map((project) => (
          <div className="table-row" key={project.id}>
            <strong>{project.displayName}</strong>
            <span>{project.dataSourceCount}</span>
            <span>{project.memberCount}</span>
            <code>{project.policyRevision}</code>
          </div>
        ))}
        {overview?.projects.length === 0 && (
          <div className="empty">{t("No managed projects assigned.")}</div>
        )}
      </div>
      <form className="inline-form" onSubmit={assignProject}>
        <label>
          {t("Project")}
          <select
            required
            value={assignmentProjectId}
            onChange={(event) => setAssignmentProjectId(event.target.value)}
          >
            <option value="">{t("Select project")}</option>
            {overview?.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Member")}
          <select
            required
            value={assignmentUserId}
            onChange={(event) => setAssignmentUserId(event.target.value)}
          >
            <option value="">{t("Select member")}</option>
            {overview?.members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>
        <button className="primary-button" disabled={loading}>
          {t("Assign project")}
        </button>
      </form>
    </section>
  );
}
