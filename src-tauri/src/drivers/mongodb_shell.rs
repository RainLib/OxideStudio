//! Mongo shell structural parser facade; command lowering, arguments, values, and delimiter scanning stay separate.

mod arguments;
mod command;
mod source;
mod values;

pub(super) use command::{looks_like_shell_command, parse_commands};

#[cfg(test)]
#[allow(unused_imports)]
pub(super) use arguments::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use command::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use source::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use values::*;
#[cfg(test)]
mod tests;
