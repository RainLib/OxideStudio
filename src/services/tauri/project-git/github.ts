import { invokeRawCommand } from "../client";
import type {
  GitHubCliStatus,
  GitHubRepository,
  ProjectGitOperationResult,
} from "./contracts";

export const projectGitHubService = {
  getGitHubStatus: (): Promise<GitHubCliStatus> =>
    invokeRawCommand("get_github_cli_status"),

  authenticateGitHub: (token: string): Promise<GitHubCliStatus> =>
    invokeRawCommand("authenticate_github_cli", { token }),

  searchGitHub: (query: string): Promise<GitHubRepository[]> =>
    invokeRawCommand("search_github_repositories", { query }),

  clone: (options: {
    source: string;
    destination: string;
    github?: boolean;
    shallowDepth?: number | null;
  }): Promise<ProjectGitOperationResult> =>
    invokeRawCommand("clone_git_repository", {
      source: options.source,
      destination: options.destination,
      github: options.github ?? false,
      shallowDepth: options.shallowDepth ?? null,
    }),
};
