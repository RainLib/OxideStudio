//! Project workspace commands keep stable Tauri and Agent Host paths while implementations live in focused modules.

mod agent;
mod commands;
mod completion;
mod filesystem;
mod git;
mod models;

pub(crate) use agent::{
    agent_apply_project_file_change, agent_list_project_entries, agent_project_directory,
    agent_read_project_file,
};
pub use commands::*;
pub use git::*;
pub use models::{
    ProjectCompletionContextRequest, ProjectCompletionSnippet, ProjectEntry, ProjectEntryKind,
    ProjectFileAppliedChange, ProjectFilePreview, ProjectFileProposal, ProjectFileRead,
    ProjectFileWrite, ProjectGitChangeSet, ProjectGitFileChange, ProjectGitFileDiff,
    ProjectGitRevisionStatus, ProjectLspDocument, ProjectLspDocumentsRequest,
};

#[cfg(test)]
#[allow(unused_imports)]
pub(super) use agent::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use commands::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use completion::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use filesystem::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use git::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use models::*;

#[cfg(test)]
mod tests;
