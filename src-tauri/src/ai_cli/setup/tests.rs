use super::authentication_verification::authentication_verification_may_be_pending;
use super::codebuddy_authentication::has_codebuddy_user;
use super::codebuddy_authentication::parse_authentication_methods;
use super::packages::managed_package_spec;
use crate::ai_cli::CliProviderKind;
use serde_json::json;

#[test]
fn managed_packages_are_exactly_versioned_and_integrity_pinned() {
    for provider in [CliProviderKind::CodexCli, CliProviderKind::CodebuddyCli] {
        let package = managed_package_spec(provider);
        assert!(!package.version.is_empty());
        assert!(!package.reference().ends_with("@latest"));
        assert!(package.integrity.starts_with("sha512-"));
    }
}

#[test]
fn parses_codebuddy_acp_authentication_methods() {
    let methods = parse_authentication_methods(&json!({
        "authMethods": [
            { "id": "internal", "name": "Login with WeChat", "description": null },
            { "id": "external", "name": "Login with Google/Github", "description": "Browser login" }
        ]
    }));
    assert_eq!(methods.len(), 2);
    assert_eq!(methods[0].id, "internal");
    assert_eq!(methods[1].description.as_deref(), Some("Browser login"));
}

#[test]
fn recognizes_codebuddy_user_without_reading_credentials() {
    assert!(has_codebuddy_user(&json!({
        "userInfo": { "userName": "user", "token": "must-not-escape" }
    })));
    assert!(!has_codebuddy_user(&json!({ "userInfo": null })));
}

#[test]
fn treats_only_account_propagation_failures_as_verification_retryable() {
    assert!(authentication_verification_may_be_pending(
        "CodeBuddy is not authenticated yet"
    ));
    assert!(authentication_verification_may_be_pending(
        "credential is still being saved"
    ));
    assert!(!authentication_verification_may_be_pending(
        "failed to parse an authentication token"
    ));
    assert!(!authentication_verification_may_be_pending(
        "ACP protocol response was invalid"
    ));
}

#[tokio::test]
async fn cancellation_notifies_the_worker_and_rejects_late_status_updates() {
    use super::authentication_state::{
        authentication_status, cancel_authentication, finish_authentication_error,
        update_authentication, ManagedAuthenticationSession, AUTHENTICATION_SESSIONS,
    };
    use crate::ai_cli::{CliAuthenticationPhase, CliAuthenticationStatus};
    let id = uuid::Uuid::new_v4().to_string();
    let (cancellation, receiver) = tokio::sync::watch::channel(false);
    AUTHENTICATION_SESSIONS.lock().await.insert(
        id.clone(),
        ManagedAuthenticationSession {
            profile_id: "test-profile".into(),
            status: CliAuthenticationStatus {
                session_id: id.clone(),
                provider: CliProviderKind::CodexCli,
                phase: CliAuthenticationPhase::WaitingForCallback,
                message: "Waiting".into(),
                method_id: Some("browser".into()),
            },
            cancellation,
        },
    );
    let cancelled = cancel_authentication(&id).await.unwrap();
    assert!(*receiver.borrow());
    assert_eq!(cancelled.phase, CliAuthenticationPhase::Cancelled);
    update_authentication(&id, CliAuthenticationPhase::Succeeded, "Late success").await;
    finish_authentication_error(&id, "Late failure").await;
    let final_status = authentication_status(&id).await.unwrap();
    AUTHENTICATION_SESSIONS.lock().await.remove(&id);
    assert_eq!(final_status.phase, CliAuthenticationPhase::Cancelled);
    assert_eq!(final_status.message, cancelled.message);
}

#[tokio::test]
async fn completed_installation_keeps_its_result_when_progress_arrives_late() {
    use super::installation::{
        installation_status, update_installation, ManagedInstallationSession, INSTALLATION_SESSIONS,
    };
    use crate::ai_cli::{CliInstallResult, CliInstallationPhase, CliInstallationStatus};
    let id = uuid::Uuid::new_v4().to_string();
    INSTALLATION_SESSIONS.lock().await.insert(
        id.clone(),
        ManagedInstallationSession {
            status: CliInstallationStatus {
                session_id: id.clone(),
                provider: CliProviderKind::CodexCli,
                phase: CliInstallationPhase::Succeeded,
                message: "Ready".into(),
                result: Some(CliInstallResult {
                    provider: CliProviderKind::CodexCli,
                    executable_path: "/test/managed/codex".into(),
                    message: "Verified".into(),
                }),
            },
        },
    );
    update_installation(&id, CliInstallationPhase::Downloading, "Late progress").await;
    let status = installation_status(&id).await.unwrap();
    INSTALLATION_SESSIONS.lock().await.remove(&id);
    assert_eq!(status.phase, CliInstallationPhase::Succeeded);
    assert_eq!(status.message, "Ready");
    assert_eq!(
        status.result.unwrap().executable_path,
        "/test/managed/codex"
    );
}

#[test]
fn staged_install_requires_both_the_entry_point_and_exact_package_version() {
    use super::packages::verify_staged_install;
    use super::paths::managed_executable_path;
    let staging = tempfile::tempdir().unwrap();
    let provider = CliProviderKind::CodexCli;
    let package = managed_package_spec(provider);
    assert!(verify_staged_install(staging.path(), provider, package).is_err());
    let executable = managed_executable_path(staging.path(), provider);
    std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
    std::fs::write(executable, "test fixture").unwrap();
    let manifest = package.package_json_path(staging.path());
    std::fs::create_dir_all(manifest.parent().unwrap()).unwrap();
    std::fs::write(&manifest, r#"{"version":"wrong-version"}"#).unwrap();
    assert!(verify_staged_install(staging.path(), provider, package)
        .unwrap_err()
        .to_string()
        .contains("version mismatch"));
    std::fs::write(&manifest, json!({"version": package.version}).to_string()).unwrap();
    verify_staged_install(staging.path(), provider, package).unwrap();
}

#[test]
fn failed_activation_restores_the_previous_managed_installation() {
    use super::packages::activate_managed_install;
    let parent = tempfile::tempdir().unwrap();
    let target = parent.path().join("codex");
    std::fs::create_dir(&target).unwrap();
    std::fs::write(target.join("existing-entry"), "old installation").unwrap();
    let missing_staging = parent.path().join("missing-staging");
    assert!(
        activate_managed_install(&target, &missing_staging, CliProviderKind::CodexCli).is_err()
    );
    assert_eq!(
        std::fs::read_to_string(target.join("existing-entry")).unwrap(),
        "old installation"
    );
    assert_eq!(std::fs::read_dir(parent.path()).unwrap().count(), 1);
}
