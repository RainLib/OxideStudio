use super::super::*;
use super::support::{create_directory_symlink, create_file_symlink};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use std::{
    collections::HashSet,
    fs,
    sync::{Arc, Barrier},
};
use tempfile::TempDir;

#[test]
fn rejects_absolute_and_parent_paths() {
    let temp = TempDir::new().unwrap();
    let root = ProjectRoot::new(temp.path()).unwrap();
    let absolute = temp.path().join("absolute.sql");

    for invalid in [
        "../outside.sql".to_string(),
        "nested/../../outside.sql".to_string(),
        absolute.to_string_lossy().into_owned(),
    ] {
        assert!(root.read_file(&invalid).is_err(), "accepted {invalid:?}");
    }

    #[cfg(windows)]
    for invalid in [r"C:drive-relative.sql", r"\\server\share\file.sql"] {
        assert!(root.read_file(invalid).is_err(), "accepted {invalid:?}");
    }
}

#[test]
fn rejects_operations_bound_to_a_different_project_root() {
    let configured = TempDir::new().unwrap();
    let stale = TempDir::new().unwrap();
    let root = ProjectRoot::new(configured.path()).unwrap();

    assert!(assert_expected_project_root(&root, configured.path().to_str()).is_ok());
    let error = assert_expected_project_root(&root, stale.path().to_str()).unwrap_err();
    assert!(error.starts_with(PROJECT_ROOT_CHANGED_PREFIX), "{error}");
}

#[test]
fn project_completion_context_ranks_database_files_and_excludes_secrets() {
    let temp = TempDir::new().unwrap();
    fs::create_dir_all(temp.path().join("queries")).unwrap();
    fs::create_dir_all(temp.path().join("node_modules/pkg")).unwrap();
    fs::write(
        temp.path().join("queries/users.sql"),
        "SELECT id, email FROM users WHERE active = true;",
    )
    .unwrap();
    fs::write(
        temp.path().join("queries/orders.sql"),
        "SELECT id FROM orders;",
    )
    .unwrap();
    fs::write(temp.path().join(".env.sql"), "SELECT secret FROM users;").unwrap();
    fs::write(
        temp.path().join("node_modules/pkg/users.sql"),
        "SELECT password FROM users;",
    )
    .unwrap();

    let root = ProjectRoot::new(temp.path()).unwrap();
    let index = completion_index(&root).unwrap();
    assert_eq!(index.files.len(), 2);
    let snippets = ranked_project_snippets(
        &index,
        &ProjectCompletionContextRequest {
            project_id: "project".to_string(),
            expected_root: None,
            active_file: Some("queries/current.sql".to_string()),
            query: "SELECT users.email".to_string(),
            referenced_objects: vec!["users".to_string()],
        },
    );
    assert_eq!(snippets[0].relative_path, "queries/users.sql");
    assert!(snippets[0].content.contains("email"));
    assert!(snippets
        .iter()
        .all(|snippet| !snippet.content.contains("password")));
}

#[test]
fn project_lsp_documents_only_include_bounded_saved_sql_files() {
    let temp = TempDir::new().unwrap();
    fs::create_dir_all(temp.path().join("queries")).unwrap();
    fs::create_dir_all(temp.path().join("node_modules/pkg")).unwrap();
    fs::write(temp.path().join("queries/report.sql"), "SELECT 1;").unwrap();
    fs::write(temp.path().join("queries/seed.mysql"), "SELECT 2;").unwrap();
    fs::write(
        temp.path().join("queries/config.json"),
        "{\"token\": \"no\"}",
    )
    .unwrap();
    fs::write(temp.path().join(".env.sql"), "SELECT secret;").unwrap();
    fs::write(
        temp.path().join("node_modules/pkg/dependency.sql"),
        "SELECT 3;",
    )
    .unwrap();

    let root = ProjectRoot::new(temp.path()).unwrap();
    let documents = project_lsp_documents(&root).unwrap();

    assert_eq!(documents.len(), 2);
    assert_eq!(
        documents
            .iter()
            .map(|document| document.relative_path.as_str())
            .collect::<HashSet<_>>(),
        HashSet::from(["queries/report.sql", "queries/seed.mysql"]),
    );
    assert!(documents
        .iter()
        .all(|document| !document.content.contains("secret")));
}

#[test]
fn project_completion_index_is_invalidated_after_file_mutation() {
    let temp = TempDir::new().unwrap();
    let root = ProjectRoot::new(temp.path()).unwrap();
    assert!(completion_index(&root).unwrap().files.is_empty());
    root.create_file("users.sql", "SELECT id FROM users;")
        .unwrap();
    invalidate_completion_index(&root);
    assert_eq!(completion_index(&root).unwrap().files.len(), 1);
}

#[test]
fn project_file_crud_preserves_revision_contract() {
    let temp = TempDir::new().unwrap();
    let root = ProjectRoot::new(temp.path()).unwrap();

    let directory = root.create_directory("queries").unwrap();
    assert_eq!(directory.kind, ProjectEntryKind::Directory);

    let created = root
        .create_file("queries/report.sql", "select 1;\n")
        .unwrap();
    assert_eq!(created.previous_revision, None);
    assert_eq!(created.introduced_lines, vec![1]);
    assert!(!created.line_evidence_truncated);
    assert!(root
        .create_file("queries/report.sql", "select 2;\n")
        .is_err());

    let read = root.read_file("queries/report.sql").unwrap();
    assert_eq!(read.content, "select 1;\n");
    assert_eq!(read.revision, created.revision);

    let entries = root.list_entries(Some("queries")).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].relative_path, "queries/report.sql");
    assert_eq!(entries[0].kind, ProjectEntryKind::File);

    let written = root
        .write_file("queries/report.sql", "select 2;\n", &read.revision)
        .unwrap();
    assert_ne!(written.revision, read.revision);
    assert_eq!(
        written.previous_revision.as_deref(),
        Some(read.revision.as_str())
    );
    assert_eq!(written.introduced_lines, vec![1]);
    assert_eq!(
        fs::read_to_string(temp.path().join("queries/report.sql")).unwrap(),
        "select 2;\n"
    );

    let renamed = root
        .rename_entry("queries/report.sql", "queries/final.sql")
        .unwrap();
    assert_eq!(renamed.relative_path, "queries/final.sql");
    assert!(!temp.path().join("queries/report.sql").exists());

    root.delete_entry("queries/final.sql", false).unwrap();
    root.delete_entry("queries", false).unwrap();
    assert!(!temp.path().join("queries").exists());
}

#[test]
fn applied_file_changes_write_immediately_and_can_be_safely_undone() {
    let temp = TempDir::new().unwrap();
    let root = ProjectRoot::new(temp.path()).unwrap();
    fs::write(temp.path().join("existing.sql"), "select 1;\n").unwrap();
    let existing = root.read_file("existing.sql").unwrap();

    let updated = root
        .prepare_file_change(
            "existing.sql",
            "select 1;\nselect 2;\n",
            Some(&existing.revision),
            false,
        )
        .unwrap();
    assert_eq!(
        updated.base_revision.as_deref(),
        Some(existing.revision.as_str())
    );
    assert_eq!(updated.additions, 1);
    assert_eq!(updated.deletions, 0);
    let updated_write = root
        .write_file(
            "existing.sql",
            &updated.proposed_content,
            updated.base_revision.as_deref().unwrap(),
        )
        .unwrap();
    assert_eq!(
        fs::read_to_string(temp.path().join("existing.sql")).unwrap(),
        "select 1;\nselect 2;\n"
    );

    let created = root
        .prepare_file_change("sql/generated/new.sql", "select 3;\n", None, true)
        .unwrap();
    assert_eq!(created.base_revision, None);
    let created_write = root
        .create_file("sql/generated/new.sql", &created.proposed_content)
        .unwrap();
    assert_eq!(
        fs::read_to_string(temp.path().join("sql/generated/new.sql")).unwrap(),
        "select 3;\n"
    );

    root.write_file(
        "existing.sql",
        &updated.original_content,
        &updated_write.revision,
    )
    .unwrap();
    root.delete_file_if_revision("sql/generated/new.sql", &created_write.revision)
        .unwrap();
    assert_eq!(
        fs::read_to_string(temp.path().join("existing.sql")).unwrap(),
        "select 1;\n"
    );
    assert!(!temp.path().join("sql/generated/new.sql").exists());

    let changed = root.create_file("changed.sql", "first\n").unwrap();
    fs::write(temp.path().join("changed.sql"), "external\n").unwrap();
    let conflict = root
        .delete_file_if_revision("changed.sql", &changed.revision)
        .unwrap_err()
        .to_string();
    assert!(conflict.starts_with(REVISION_CONFLICT_PREFIX), "{conflict}");
    assert!(temp.path().join("changed.sql").exists());
}

#[test]
fn file_change_counts_match_insertions_deletions_and_replacements() {
    assert_eq!(
        project_file_line_change_counts("a\nb\nc", "a\nx\nc\nd"),
        (2, 1)
    );
    assert_eq!(project_file_line_change_counts("a\nb", "a\nb"), (0, 0));
    assert_eq!(project_file_line_change_counts("", "first\nsecond"), (2, 0));
}

#[test]
fn create_file_creates_missing_parent_directories_inside_project_root() {
    let temp = TempDir::new().unwrap();
    let root = ProjectRoot::new(temp.path()).unwrap();

    let created = root
        .create_file(
            "sql/generated/ai_model_select.sql",
            "SELECT model_name FROM ai_models;\n",
        )
        .unwrap();

    assert_eq!(created.relative_path, "sql/generated/ai_model_select.sql");
    assert_eq!(created.previous_revision, None);
    assert_eq!(
        fs::read_to_string(temp.path().join("sql/generated/ai_model_select.sql")).unwrap(),
        "SELECT model_name FROM ai_models;\n"
    );
    assert!(temp.path().join("sql/generated").is_dir());
}

#[test]
fn create_file_rejects_a_non_directory_parent_component() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("sql"), "not a directory").unwrap();
    let root = ProjectRoot::new(temp.path()).unwrap();

    let error = root
        .create_file("sql/ai_model_select.sql", "SELECT 1;\n")
        .unwrap_err()
        .to_string();

    assert!(error.contains("parent is not a directory"), "{error}");
    assert!(!temp.path().join("ai_model_select.sql").exists());
}

#[test]
fn line_evidence_only_claims_content_absent_from_the_pre_write_file() {
    let (lines, truncated) = project_file_line_evidence(
        "SELECT id\nFROM users\nORDER BY id\n",
        "SELECT id\nFROM active_users\nORDER BY id\nLIMIT 20\n",
    );

    assert_eq!(lines, vec![2, 4]);
    assert!(!truncated);

    let repeated = project_file_line_evidence("same\n", "same\nsame\nnew\n");
    assert_eq!(repeated, (vec![3], false));

    let oversized = (0..=PROJECT_FILE_LINE_EVIDENCE_LIMIT)
        .map(|index| format!("line-{index}"))
        .collect::<Vec<_>>()
        .join("\n");
    let (bounded, truncated) = project_file_line_evidence("", &oversized);
    assert_eq!(bounded.len(), PROJECT_FILE_LINE_EVIDENCE_LIMIT);
    assert!(truncated);
}

#[test]
fn project_file_preview_reads_supported_images_without_utf8_decoding() {
    let temp = TempDir::new().unwrap();
    let root = ProjectRoot::new(temp.path()).unwrap();
    let bytes = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0xff];
    fs::write(temp.path().join("preview.png"), bytes).unwrap();

    let preview = root.read_file_preview("preview.png").unwrap();
    assert_eq!(preview.relative_path, "preview.png");
    assert_eq!(preview.media_type, "image/png");
    assert_eq!(preview.data_base64, BASE64_STANDARD.encode(bytes));
    assert_eq!(preview.revision, content_revision(&bytes));
    assert_eq!(preview.size, bytes.len() as u64);
    assert!(root.read_file("preview.png").is_err());
}

#[test]
fn project_file_preview_rejects_unsupported_binary_files() {
    let temp = TempDir::new().unwrap();
    let root = ProjectRoot::new(temp.path()).unwrap();
    fs::write(temp.path().join("archive.bin"), [0xff, 0x00]).unwrap();

    let error = root
        .read_file_preview("archive.bin")
        .unwrap_err()
        .to_string();
    assert!(error.contains("preview is not supported"), "{error}");
}

#[test]
fn detects_revision_conflicts() {
    let temp = TempDir::new().unwrap();
    let root = ProjectRoot::new(temp.path()).unwrap();
    let created = root.create_file("query.sql", "select 1").unwrap();

    fs::write(temp.path().join("query.sql"), "select 2").unwrap();
    let error = root
        .write_file("query.sql", "select 3", &created.revision)
        .unwrap_err()
        .to_string();
    assert!(error.starts_with(REVISION_CONFLICT_PREFIX), "{error}");
    assert_eq!(
        fs::read_to_string(temp.path().join("query.sql")).unwrap(),
        "select 2"
    );
}

#[test]
fn concurrent_writes_with_the_same_revision_allow_only_one_winner() {
    let temp = TempDir::new().unwrap();
    let root = Arc::new(ProjectRoot::new(temp.path()).unwrap());
    let created = root.create_file("query.sql", "select 1").unwrap();
    let barrier = Arc::new(Barrier::new(3));

    let handles = ["select 2", "select 3"].map(|content| {
        let root = Arc::clone(&root);
        let barrier = Arc::clone(&barrier);
        let revision = created.revision.clone();
        std::thread::spawn(move || {
            barrier.wait();
            root.write_file("query.sql", content, &revision)
        })
    });
    barrier.wait();

    let results = handles.map(|handle| handle.join().unwrap());
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    let conflict = results
        .into_iter()
        .find_map(Result::err)
        .unwrap()
        .to_string();
    assert!(conflict.starts_with(REVISION_CONFLICT_PREFIX), "{conflict}");
}

#[test]
fn recursive_delete_does_not_follow_links() {
    let temp = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    fs::create_dir(temp.path().join("queries")).unwrap();
    fs::write(outside.path().join("keep.sql"), "select 1").unwrap();

    let link = temp.path().join("queries/external");
    if !create_directory_symlink(outside.path(), &link) {
        return;
    }

    let root = ProjectRoot::new(temp.path()).unwrap();
    root.delete_entry("queries", true).unwrap();
    assert!(outside.path().join("keep.sql").exists());
}

#[test]
fn rejects_links_that_resolve_outside_root() {
    let temp = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    fs::write(outside.path().join("outside.sql"), "select secret").unwrap();
    let link = temp.path().join("outside.sql");
    if !create_file_symlink(&outside.path().join("outside.sql"), &link) {
        return;
    }

    let root = ProjectRoot::new(temp.path()).unwrap();
    let error = root.read_file("outside.sql").unwrap_err().to_string();
    assert!(error.contains("outside the configured root"), "{error}");

    let directory_link = temp.path().join("external-directory");
    if !create_directory_symlink(outside.path(), &directory_link) {
        return;
    }
    let error = root
        .create_file("external-directory/new.sql", "select 1")
        .unwrap_err()
        .to_string();
    assert!(error.contains("outside the configured root"), "{error}");
    assert!(!outside.path().join("new.sql").exists());
}
