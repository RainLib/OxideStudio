//! Project Git command facade; process execution, validation, snapshots, operations, patches, and GitHub CLI stay separate.

pub mod github;
mod models;
pub mod operations;
pub mod patch;
pub mod repository;
mod runtime;
mod validation;

pub use models::{
    GitHubCliStatus, GitHubRepository, ProjectGitBranch, ProjectGitCommit, ProjectGitCommitFile,
    ProjectGitCommitFiles, ProjectGitFileVersions, ProjectGitOperationResult, ProjectGitPatch,
    ProjectGitRemote, ProjectGitRepository, ProjectGitWorkspaceFile,
};

#[cfg(test)]
#[allow(unused_imports)]
pub(super) use github::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use models::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use operations::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use patch::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use repository::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use runtime::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use validation::*;
#[cfg(test)]
mod tests;
