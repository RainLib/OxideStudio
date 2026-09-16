use crate::core::protocol::CommandError;
use anyhow::Result;
use std::time::Duration;

use super::models::{GitHubCliStatus, GitHubRepository, ProjectGitOperationResult};
use super::runtime::{
    command_error, command_failure, run_bounded, stdout_text, GITHUB_REPOSITORY_LIMIT,
    GIT_CLONE_TIMEOUT, GIT_OUTPUT_LIMIT, GIT_READ_TIMEOUT, GIT_WRITE_TIMEOUT,
};
use super::validation::{validate_clone_destination, validate_remote_url};

#[tauri::command]
pub async fn get_github_cli_status() -> Result<GitHubCliStatus, CommandError> {
    let context = serde_json::json!({ "host": "github.com" });
    let version = run_bounded(
        "gh",
        &["--version".to_string()],
        None,
        None,
        4_096,
        GIT_READ_TIMEOUT,
        true,
    )
    .await;
    let Ok(version) = version else {
        return Ok(GitHubCliStatus {
            installed: false,
            authenticated: false,
            account: None,
            version: None,
        });
    };
    let version_text = stdout_text(&version).lines().next().map(str::to_string);
    let status = run_bounded(
        "gh",
        &[
            "auth".to_string(),
            "status".to_string(),
            "--hostname".to_string(),
            "github.com".to_string(),
        ],
        None,
        None,
        16_384,
        GIT_READ_TIMEOUT,
        true,
    )
    .await
    .map_err(|error| command_error("GITHUB_AUTH_STATUS_FAILED", error, true, context.clone()))?;
    if !status.success {
        return Ok(GitHubCliStatus {
            installed: true,
            authenticated: false,
            account: None,
            version: version_text,
        });
    }
    let account = run_bounded(
        "gh",
        &[
            "api".to_string(),
            "user".to_string(),
            "--jq".to_string(),
            ".login".to_string(),
        ],
        None,
        None,
        4_096,
        GIT_READ_TIMEOUT,
        true,
    )
    .await
    .ok()
    .filter(|output| output.success)
    .map(|output| stdout_text(&output))
    .filter(|value| !value.is_empty());
    Ok(GitHubCliStatus {
        installed: true,
        authenticated: true,
        account,
        version: version_text,
    })
}

#[tauri::command]
pub async fn authenticate_github_cli(token: String) -> Result<GitHubCliStatus, CommandError> {
    let context = serde_json::json!({ "host": "github.com" });
    let token = token.trim();
    if token.is_empty() || token.len() > 4_096 || token.contains(['\r', '\n', '\0']) {
        return Err(command_error(
            "GITHUB_TOKEN_INVALID",
            "GitHub token is empty, too large, or invalid",
            false,
            context,
        ));
    }
    let mut input = token.as_bytes().to_vec();
    input.push(b'\n');
    let args = [
        "auth",
        "login",
        "--hostname",
        "github.com",
        "--git-protocol",
        "https",
        "--with-token",
    ]
    .map(str::to_string);
    let output = run_bounded(
        "gh",
        &args,
        None,
        Some(&input),
        16_384,
        Duration::from_secs(60),
        false,
    )
    .await
    .map_err(|error| command_error("GITHUB_AUTH_FAILED", error, true, context.clone()))?;
    input.fill(0);
    if !output.success {
        return Err(command_error(
            "GITHUB_AUTH_FAILED",
            command_failure("gh auth login", &output),
            false,
            context,
        ));
    }
    get_github_cli_status().await
}

#[tauri::command]
pub async fn search_github_repositories(
    query: String,
) -> Result<Vec<GitHubRepository>, CommandError> {
    let context = serde_json::json!({ "host": "github.com" });
    let query = query.trim();
    if query.is_empty() || query.len() > 256 || query.contains('\0') {
        return Err(command_error(
            "GITHUB_SEARCH_INVALID",
            "repository search query is empty, too large, or invalid",
            false,
            context,
        ));
    }
    let fields =
        "fullName,description,url,isPrivate,isArchived,stargazersCount,updatedAt,defaultBranch";
    let args = vec![
        "search".to_string(),
        "repos".to_string(),
        query.to_string(),
        "--limit".to_string(),
        GITHUB_REPOSITORY_LIMIT.to_string(),
        "--json".to_string(),
        fields.to_string(),
    ];
    let output = run_bounded(
        "gh",
        &args,
        None,
        None,
        GIT_OUTPUT_LIMIT,
        GIT_WRITE_TIMEOUT,
        true,
    )
    .await
    .map_err(|error| command_error("GITHUB_SEARCH_FAILED", error, true, context.clone()))?;
    if !output.success {
        return Err(command_error(
            "GITHUB_SEARCH_FAILED",
            command_failure("gh search repos", &output),
            true,
            context,
        ));
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|error| command_error("GITHUB_SEARCH_RESPONSE_INVALID", error, false, context))
}

#[tauri::command]
pub async fn clone_git_repository(
    source: String,
    destination: String,
    github: bool,
    shallow_depth: Option<u32>,
) -> Result<ProjectGitOperationResult, CommandError> {
    let context = serde_json::json!({ "destination": destination });
    let destination = validate_clone_destination(&destination).map_err(|error| {
        command_error(
            "PROJECT_GIT_CLONE_DESTINATION_INVALID",
            error,
            false,
            context.clone(),
        )
    })?;
    if shallow_depth.is_some_and(|depth| depth == 0 || depth > 100_000) {
        return Err(command_error(
            "PROJECT_GIT_CLONE_DEPTH_INVALID",
            "shallow clone depth must be between 1 and 100000",
            false,
            context,
        ));
    }
    let source = if github {
        let source = source.trim();
        if source.is_empty()
            || source.len() > 512
            || source.starts_with('-')
            || source.contains('\0')
        {
            return Err(command_error(
                "PROJECT_GIT_CLONE_SOURCE_INVALID",
                "GitHub repository name is invalid",
                false,
                context,
            ));
        }
        source.to_string()
    } else {
        validate_remote_url(&source).map_err(|error| {
            command_error(
                "PROJECT_GIT_CLONE_SOURCE_INVALID",
                error,
                false,
                context.clone(),
            )
        })?
    };
    let mut args = if github {
        vec![
            "repo".to_string(),
            "clone".to_string(),
            source,
            destination.to_string_lossy().to_string(),
        ]
    } else {
        vec![
            "clone".to_string(),
            "--".to_string(),
            source,
            destination.to_string_lossy().to_string(),
        ]
    };
    if let Some(depth) = shallow_depth {
        if github {
            args.extend(["--".to_string(), "--depth".to_string(), depth.to_string()]);
        } else {
            args.splice(1..1, ["--depth".to_string(), depth.to_string()]);
        }
    }
    let program = if github { "gh" } else { "git" };
    let output = run_bounded(
        program,
        &args,
        None,
        None,
        GIT_OUTPUT_LIMIT,
        GIT_CLONE_TIMEOUT,
        false,
    )
    .await
    .map_err(|error| command_error("PROJECT_GIT_CLONE_FAILED", error, true, context.clone()))?;
    if !output.success {
        return Err(command_error(
            "PROJECT_GIT_CLONE_FAILED",
            command_failure("repository clone", &output),
            true,
            context,
        ));
    }
    Ok(ProjectGitOperationResult {
        message: "Repository cloned.".to_string(),
    })
}
