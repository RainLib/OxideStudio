#[derive(Debug, Clone)]
pub(super) struct ApprovedQueryReview {
    pub(super) operation_type: String,
    pub(super) destructive: bool,
    pub(super) confirmation_phrase: Option<String>,
    pub(super) summary: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum MutationTurnState {
    Started,
    Completed,
    Unknown,
}
