use super::super::*;
use std::fs;
use tempfile::TempDir;

#[test]
fn parses_git_porcelain_status_without_losing_rename_scope() {
    let changes = parse_git_status(
        b" M src/query.ts\0A  src/new.ts\0?? notes.txt\0R  src/renamed.ts\0src/old.ts\0 M ../outside.sql\0",
    );

    assert_eq!(changes.len(), 4);
    assert!(changes.iter().any(|change| {
        change.relative_path == "src/query.ts" && change.unstaged && !change.staged
    }));
    assert!(changes.iter().any(|change| {
        change.relative_path == "src/new.ts" && change.status == "added" && change.staged
    }));
    assert!(changes.iter().any(|change| change.untracked));
    let renamed = changes
        .iter()
        .find(|change| change.status == "renamed")
        .unwrap();
    assert_eq!(renamed.relative_path, "src/renamed.ts");
    assert_eq!(renamed.previous_path.as_deref(), Some("src/old.ts"));
    assert!(changes
        .iter()
        .all(|change| !change.relative_path.contains("..")));
}

#[test]
fn counts_only_real_added_and_removed_diff_lines() {
    let patch = "--- a/file\n+++ b/file\n@@ -1,2 +1,2 @@\n-old\n+new\n same";
    assert_eq!(diff_line_counts(patch), (1, 1));
}

#[test]
fn builds_git_diff_arguments_for_each_supported_scope() {
    assert_eq!(
        ProjectGitDiffScope::All.arguments("queries/report.sql"),
        vec![
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "HEAD",
            "--",
            "queries/report.sql",
        ]
    );
    assert_eq!(
        ProjectGitDiffScope::Staged.arguments("queries/report.sql"),
        vec![
            "diff",
            "--cached",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--",
            "queries/report.sql",
        ]
    );
    assert_eq!(
        ProjectGitDiffScope::Working.arguments("queries/report.sql"),
        vec![
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--",
            "queries/report.sql",
        ]
    );
    assert!(ProjectGitDiffScope::parse(Some("unknown")).is_none());
}

#[test]
fn builds_a_bounded_untracked_text_diff_without_leaving_the_project() {
    let temp = TempDir::new().unwrap();
    fs::create_dir(temp.path().join("queries")).unwrap();
    fs::write(temp.path().join("queries/new.sql"), "select 1;\n").unwrap();
    let root = ProjectRoot::new(temp.path()).unwrap();

    let (patch, binary, truncated) = untracked_file_patch(&root, "queries/new.sql").unwrap();
    assert!(!binary);
    assert!(!truncated);
    assert!(patch.contains("--- /dev/null"));
    assert!(patch.contains("+++ b/queries/new.sql"));
    assert!(patch.contains("+select 1;"));
    assert!(untracked_file_patch(&root, "../outside.sql").is_err());
}

#[tokio::test]
async fn identifies_only_untracked_paths_for_synthetic_diff_fallback() {
    let temp = TempDir::new().unwrap();
    let initialized = std::process::Command::new("git")
        .args(["init", "--quiet"])
        .current_dir(temp.path())
        .status()
        .unwrap();
    assert!(initialized.success());
    fs::write(temp.path().join("new.sql"), "select 1;\n").unwrap();
    let root = ProjectRoot::new(temp.path()).unwrap();

    assert!(git_path_is_untracked(&root, "new.sql").await.unwrap());

    let staged = std::process::Command::new("git")
        .args(["add", "--", "new.sql"])
        .current_dir(temp.path())
        .status()
        .unwrap();
    assert!(staged.success());
    assert!(!git_path_is_untracked(&root, "new.sql").await.unwrap());
}

#[tokio::test]
async fn resolves_scope_content_revisions_without_confusing_index_and_worktree() {
    let temp = TempDir::new().unwrap();
    let initialized = std::process::Command::new("git")
        .args(["init", "--quiet"])
        .current_dir(temp.path())
        .status()
        .unwrap();
    assert!(initialized.success());
    let path = temp.path().join("report.sql");
    fs::write(&path, "select 'staged';\n").unwrap();
    let staged = std::process::Command::new("git")
        .args(["add", "--", "report.sql"])
        .current_dir(temp.path())
        .status()
        .unwrap();
    assert!(staged.success());
    fs::write(&path, "select 'working';\n").unwrap();
    let root = ProjectRoot::new(temp.path()).unwrap();

    let (index_revision, index_status) =
        git_current_side_revision(&root, "report.sql", ProjectGitDiffScope::Staged)
            .await
            .unwrap();
    let (working_revision, working_status) =
        git_current_side_revision(&root, "report.sql", ProjectGitDiffScope::Working)
            .await
            .unwrap();
    let (all_revision, all_status) =
        git_current_side_revision(&root, "report.sql", ProjectGitDiffScope::All)
            .await
            .unwrap();
    let expected_index_revision = content_revision(b"select 'staged';\n");
    let expected_working_revision = content_revision(b"select 'working';\n");

    assert_eq!(index_status, ProjectGitRevisionStatus::Available);
    assert_eq!(
        index_revision.as_deref(),
        Some(expected_index_revision.as_str())
    );
    assert_eq!(working_status, ProjectGitRevisionStatus::Available);
    assert_eq!(
        working_revision.as_deref(),
        Some(expected_working_revision.as_str())
    );
    assert_eq!(all_status, ProjectGitRevisionStatus::Available);
    assert_eq!(all_revision, working_revision);

    fs::remove_file(path).unwrap();
    let (missing_revision, missing_status) =
        git_current_side_revision(&root, "report.sql", ProjectGitDiffScope::Working)
            .await
            .unwrap();
    assert_eq!(missing_revision, None);
    assert_eq!(missing_status, ProjectGitRevisionStatus::Missing);

    fs::write(
        temp.path().join("large.sql"),
        vec![b'x'; AGENT_PROJECT_FILE_LIMIT as usize + 1],
    )
    .unwrap();
    let (large_revision, large_status) =
        git_current_side_revision(&root, "large.sql", ProjectGitDiffScope::Working)
            .await
            .unwrap();
    assert_eq!(large_revision, None);
    assert_eq!(large_status, ProjectGitRevisionStatus::Unavailable);
}
