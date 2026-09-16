import {
  projectNameFromRootPath,
  projectRootKey,
  type ProjectSourceMode,
} from "@/features/projects/model/projectIdentity";
import {
  projectGitService,
  type GitHubCliStatus,
  type GitHubRepository,
} from "@/services/tauri/project-git.service";
import type { Project } from "@/services/tauri/store.service";
import { useProjectStore } from "@/store/useProjectStore";
import { useEffect, useMemo, useState, type FormEvent } from "react";
export function useProjectSwitcher() {
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);

  const [projectDialogOpen, setProjectDialogOpen] = useState(false);

  const [projectSourceMode, setProjectSourceMode] =
    useState<ProjectSourceMode>("local");

  const [projectAlias, setProjectAlias] = useState("");

  const [projectRootPath, setProjectRootPath] = useState("");

  const [gitRepositoryUrl, setGitRepositoryUrl] = useState("");

  const [shallowClone, setShallowClone] = useState(false);

  const [githubStatus, setGithubStatus] = useState<GitHubCliStatus | null>(
    null,
  );

  const [githubToken, setGithubToken] = useState("");

  const [githubQuery, setGithubQuery] = useState("");

  const [githubRepositories, setGithubRepositories] = useState<
    GitHubRepository[]
  >([]);

  const [selectedGithubRepository, setSelectedGithubRepository] =
    useState<GitHubRepository | null>(null);

  const [githubLoading, setGithubLoading] = useState(false);

  const [githubStatusRequested, setGithubStatusRequested] = useState(false);

  const [projectError, setProjectError] = useState<string | null>(null);

  const [isCreatingProject, setIsCreatingProject] = useState(false);

  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);

  const [projectDeleteError, setProjectDeleteError] = useState<string | null>(
    null,
  );

  const [isDeletingProject, setIsDeletingProject] = useState(false);

  const {
    projects,
    activeProjectId,
    activeProjectName,
    setActiveProject,
    createProject,
    deleteProject,
  } = useProjectStore();

  const inferredProjectName = projectRootPath
    ? projectNameFromRootPath(projectRootPath)
    : "";

  const normalizedProjectName = projectAlias.trim() || inferredProjectName;

  const projectNameExists = useMemo(
    () =>
      projects.some(
        (project) =>
          project.name.trim().toLowerCase() ===
          normalizedProjectName.toLowerCase(),
      ),
    [normalizedProjectName, projects],
  );

  const projectPathExists = useMemo(() => {
    const selectedRootKey = projectRootKey(projectRootPath);
    return Boolean(
      selectedRootKey &&
        projects.some(
          (project) => projectRootKey(project.root_path) === selectedRootKey,
        ),
    );
  }, [projectRootPath, projects]);

  const projectGroups = useMemo(() => {
    const groups = new Map<string, Project[]>();
    for (const project of projects) {
      const group =
        project.origin === "managed"
          ? project.organization_name || "Organization"
          : "My Projects";
      groups.set(group, [...(groups.get(group) || []), project]);
    }
    return [...groups.entries()];
  }, [projects]);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) || null,
    [activeProjectId, projects],
  );

  const openProjectDialog = () => {
    setProjectAlias("");
    setProjectRootPath("");
    setProjectSourceMode("local");
    setGitRepositoryUrl("");
    setShallowClone(false);
    setGithubStatus(null);
    setGithubStatusRequested(false);
    setGithubToken("");
    setGithubQuery("");
    setGithubRepositories([]);
    setSelectedGithubRepository(null);
    setProjectError(null);
    setProjectMenuOpen(false);
    setProjectDialogOpen(true);
  };

  const chooseCloneDestination = async () => {
    setProjectError(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose an Empty Clone Destination",
      });
      if (typeof selected === "string") setProjectRootPath(selected);
    } catch (error) {
      setProjectError(
        error instanceof Error
          ? error.message
          : "Failed to choose a clone destination.",
      );
    }
  };

  const refreshGithubStatus = async () => {
    setGithubStatusRequested(true);
    setGithubLoading(true);
    setProjectError(null);
    try {
      setGithubStatus(await projectGitService.getGitHubStatus());
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    } finally {
      setGithubLoading(false);
    }
  };

  const authenticateGithub = async () => {
    if (!githubToken.trim()) return;
    setGithubLoading(true);
    setProjectError(null);
    try {
      setGithubStatus(await projectGitService.authenticateGitHub(githubToken));
      setGithubToken("");
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    } finally {
      setGithubLoading(false);
    }
  };

  const searchGithub = async () => {
    if (!githubQuery.trim()) return;
    setGithubLoading(true);
    setProjectError(null);
    try {
      const repositories = await projectGitService.searchGitHub(githubQuery);
      setGithubRepositories(repositories);
      setSelectedGithubRepository((current) =>
        current &&
        repositories.some((repo) => repo.fullName === current.fullName)
          ? current
          : repositories[0] || null,
      );
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    } finally {
      setGithubLoading(false);
    }
  };

  const chooseProjectDirectory = async () => {
    setProjectError(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose Project Directory",
      });
      if (typeof selected === "string") {
        setProjectRootPath(selected);
      }
    } catch (error) {
      setProjectError(
        error instanceof Error
          ? error.message
          : "Failed to choose a project directory.",
      );
    }
  };

  const handleCreateProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectRootPath) {
      setProjectError("Choose a project directory.");
      return;
    }
    if (projectPathExists) {
      setProjectError("This directory is already linked to another project.");
      return;
    }
    if (!normalizedProjectName) {
      setProjectError("Enter a project alias or choose a named directory.");
      return;
    }
    if (projectNameExists) {
      setProjectError("A project with this name already exists.");
      return;
    }
    if (projectSourceMode === "git" && !gitRepositoryUrl.trim()) {
      setProjectError("Enter a Git repository URL.");
      return;
    }
    if (projectSourceMode === "github" && !selectedGithubRepository) {
      setProjectError("Select a GitHub repository.");
      return;
    }

    setIsCreatingProject(true);
    setProjectError(null);
    try {
      if (projectSourceMode !== "local") {
        await projectGitService.clone({
          source:
            projectSourceMode === "github"
              ? selectedGithubRepository!.fullName
              : gitRepositoryUrl,
          destination: projectRootPath,
          github: projectSourceMode === "github",
          shallowDepth: shallowClone ? 1 : null,
        });
      }
      await createProject(normalizedProjectName, projectRootPath);
      setProjectDialogOpen(false);
      setProjectAlias("");
      setProjectRootPath("");
    } catch (error) {
      setProjectError(
        error instanceof Error ? error.message : "Failed to create project.",
      );
    } finally {
      setIsCreatingProject(false);
    }
  };

  useEffect(() => {
    if (
      projectDialogOpen &&
      projectSourceMode === "github" &&
      githubStatus === null &&
      !githubStatusRequested &&
      !githubLoading
    ) {
      void refreshGithubStatus();
    }
  }, [
    githubLoading,
    githubStatus,
    githubStatusRequested,
    projectDialogOpen,
    projectSourceMode,
  ]);

  const handleDeleteProject = async () => {
    if (!projectToDelete || isDeletingProject) return;

    setIsDeletingProject(true);
    setProjectDeleteError(null);
    try {
      await deleteProject(projectToDelete.id);
      setProjectToDelete(null);
    } catch (error) {
      setProjectDeleteError(
        error instanceof Error ? error.message : "Failed to delete project.",
      );
    } finally {
      setIsDeletingProject(false);
    }
  };
  return {
    menu: {
      projectMenuOpen: projectMenuOpen,
      setProjectMenuOpen: setProjectMenuOpen,
      activeProjectName: activeProjectName,
      projectGroups: projectGroups,
      activeProjectId: activeProjectId,
      setActiveProject: setActiveProject,
      setProjectDeleteError: setProjectDeleteError,
      setProjectToDelete: setProjectToDelete,
      activeProject: activeProject,
      openProjectDialog: openProjectDialog,
    },
    createDialog: {
      projectDialogOpen: projectDialogOpen,
      setProjectDialogOpen: setProjectDialogOpen,
      handleCreateProject: handleCreateProject,
      projectSourceMode: projectSourceMode,
      setProjectSourceMode: setProjectSourceMode,
      setProjectError: setProjectError,
      isCreatingProject: isCreatingProject,
      gitRepositoryUrl: gitRepositoryUrl,
      setGitRepositoryUrl: setGitRepositoryUrl,
      githubStatus: githubStatus,
      githubToken: githubToken,
      githubQuery: githubQuery,
      githubRepositories: githubRepositories,
      selectedGithubRepository: selectedGithubRepository,
      githubLoading: githubLoading,
      setGithubToken: setGithubToken,
      setGithubQuery: setGithubQuery,
      authenticateGithub: authenticateGithub,
      refreshGithubStatus: refreshGithubStatus,
      searchGithub: searchGithub,
      setSelectedGithubRepository: setSelectedGithubRepository,
      chooseProjectDirectory: chooseProjectDirectory,
      chooseCloneDestination: chooseCloneDestination,
      projectRootPath: projectRootPath,
      shallowClone: shallowClone,
      setShallowClone: setShallowClone,
      projectAlias: projectAlias,
      setProjectAlias: setProjectAlias,
      inferredProjectName: inferredProjectName,
      normalizedProjectName: normalizedProjectName,
      projectError: projectError,
      projectPathExists: projectPathExists,
      projectNameExists: projectNameExists,
    },
    deleteDialog: {
      projectToDelete: projectToDelete,
      isDeletingProject: isDeletingProject,
      setProjectToDelete: setProjectToDelete,
      setProjectDeleteError: setProjectDeleteError,
      projectDeleteError: projectDeleteError,
      handleDeleteProject: handleDeleteProject,
    },
  };
}
