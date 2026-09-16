use anyhow::Result;
use oxide_enterprise_contracts::MembershipStatus;

pub(super) fn parse_membership_status(value: String) -> Result<MembershipStatus> {
    match value.as_str() {
        "invited" => Ok(MembershipStatus::Invited),
        "active" => Ok(MembershipStatus::Active),
        "suspended" => Ok(MembershipStatus::Suspended),
        _ => anyhow::bail!("invalid stored membership status: {value}"),
    }
}
