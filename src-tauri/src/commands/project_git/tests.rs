use super::*;

#[test]
fn remote_url_rejects_credentials_and_local_helpers() {
    assert!(validate_remote_url("https://token@github.com/acme/repo.git").is_err());
    assert!(validate_remote_url("file:///tmp/repo").is_err());
    assert!(validate_remote_url("ext::sh -c bad").is_err());
    assert_eq!(
        validate_remote_url("git@github.com:acme/repo.git").unwrap(),
        "git@github.com:acme/repo.git"
    );
    assert_eq!(
        validate_remote_url("https://github.com/acme/repo.git").unwrap(),
        "https://github.com/acme/repo.git"
    );
}

#[test]
fn relative_git_paths_stay_inside_project() {
    assert_eq!(
        validate_relative_path("sql/report.sql").unwrap(),
        "sql/report.sql"
    );
    assert!(validate_relative_path("../secret").is_err());
    assert!(validate_relative_path("/tmp/file").is_err());
}

#[test]
fn status_parser_preserves_stage_and_worktree_state() {
    let files = parse_status(b"M  sql/staged.sql\0 M sql/working.sql\0?? sql/new.sql\0R  sql/new-name.sql\0sql/old-name.sql\0");
    assert_eq!(files.len(), 4);
    assert!(files
        .iter()
        .any(|file| file.relative_path == "sql/staged.sql" && file.staged && !file.unstaged));
    assert!(files
        .iter()
        .any(|file| file.relative_path == "sql/working.sql" && !file.staged && file.unstaged));
    assert!(files
        .iter()
        .any(|file| file.relative_path == "sql/new.sql" && file.untracked));
    assert!(files
        .iter()
        .any(|file| file.previous_path.as_deref() == Some("sql/old-name.sql")));
}

#[test]
fn numstat_parser_handles_regular_and_renamed_files() {
    let counts = parse_numstat(b"2\t1\tsql/a.sql\x003\t4\t\x00sql/old.sql\x00sql/new.sql\x00");
    assert_eq!(counts.get("sql/a.sql"), Some(&(2, 1)));
    assert_eq!(counts.get("sql/new.sql"), Some(&(3, 4)));
}

#[test]
fn history_parser_uses_control_character_boundaries() {
    let commits =
        parse_commits(b"abc\x1fa1\x1fA User\x1fa@example.com\x1f1710000000\x1fsubject\x1e");
    assert_eq!(commits.len(), 1);
    assert_eq!(commits[0].short_hash, "a1");
    assert_eq!(commits[0].timestamp, 1_710_000_000);
}

#[test]
fn commit_revision_requires_a_full_object_id() {
    assert_eq!(
        validate_commit_revision(&"A".repeat(40)).unwrap(),
        "a".repeat(40),
    );
    assert!(validate_commit_revision("HEAD").is_err());
    assert!(validate_commit_revision("abc1234").is_err());
    assert!(validate_commit_revision(&"g".repeat(40)).is_err());
}

#[test]
fn diff_counter_ignores_patch_headers() {
    assert_eq!(
        diff_counts("--- a/a.sql\n+++ b/a.sql\n-old\n+new\n+extra\n"),
        (2, 1)
    );
}
