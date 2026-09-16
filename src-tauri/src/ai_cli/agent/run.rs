use crate::{
    agent::bridge::PrivateBridgeSession,
    ai_cli::{runtime::CliCommandSpec, CliProviderKind},
};
use anyhow::Result;
use serde_json::Value;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    time::Duration,
};
use tempfile::TempDir;
use tokio::sync::{mpsc, watch};
use zeroize::Zeroize;

pub struct PreparedCliRun {
    pub provider: CliProviderKind,
    pub command: CliCommandSpec,
    pub args: Vec<String>,
    pub environment: BTreeMap<String, String>,
    pub stdin: Vec<u8>,
    pub timeout: Duration,
    pub(super) protocol: CliRunProtocol,
    pub(super) working_directory: PathBuf,
    pub(super) _isolated_working_directory: TempDir,
    pub(super) _bridge: PrivateBridgeSession,
}

pub(super) enum CliRunProtocol {
    Jsonl,
    CodexAppServer {
        model: Option<String>,
        effort: Option<String>,
        service_tier: Option<String>,
        full_access: bool,
        collaboration_mode: &'static str,
    },
}

impl PreparedCliRun {
    pub fn working_directory(&self) -> &Path {
        &self.working_directory
    }

    pub async fn run(
        self,
        cancellation: watch::Receiver<bool>,
        events: mpsc::UnboundedSender<Value>,
    ) -> Result<crate::ai_cli::runtime::CliJsonlOutput> {
        match &self.protocol {
            CliRunProtocol::Jsonl => {
                crate::ai_cli::runtime::run_jsonl_process(
                    &self.command,
                    &self.args,
                    &self.environment,
                    self.working_directory(),
                    &self.stdin,
                    self.timeout,
                    cancellation,
                    move |event| {
                        let _ = events.send(event);
                    },
                )
                .await
            }
            CliRunProtocol::CodexAppServer {
                model,
                effort,
                service_tier,
                full_access,
                collaboration_mode,
            } => {
                crate::ai_cli::runtime::run_codex_app_server(
                    &self.command,
                    &self.args,
                    &self.environment,
                    self.working_directory(),
                    &self.stdin,
                    model.as_deref(),
                    effort.as_deref(),
                    service_tier.as_deref(),
                    *full_access,
                    collaboration_mode,
                    self.timeout,
                    cancellation,
                    move |event| {
                        let _ = events.send(event);
                    },
                )
                .await
            }
        }
    }
}

impl Drop for PreparedCliRun {
    fn drop(&mut self) {
        for value in self.environment.values_mut() {
            value.zeroize();
        }
        self.stdin.zeroize();
    }
}
