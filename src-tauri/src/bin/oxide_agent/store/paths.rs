use super::APP_IDENTIFIER;
use anyhow::{Context, Result};
use std::{
    env,
    path::{Path, PathBuf},
};

pub fn resolve_data_dir(explicit: Option<PathBuf>) -> Result<PathBuf> {
    if let Some(path) = explicit {
        return Ok(path);
    }
    if let Some(path) = env::var_os("OXIDE_DATA_DIR").filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(path));
    }
    default_config_dir()
}

fn default_config_dir() -> Result<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let home = env::var_os("HOME").context("HOME is unavailable")?;
        Ok(PathBuf::from(home)
            .join("Library/Application Support")
            .join(APP_IDENTIFIER))
    }
    #[cfg(target_os = "windows")]
    {
        let roaming = env::var_os("APPDATA").context("APPDATA is unavailable")?;
        Ok(PathBuf::from(roaming).join(APP_IDENTIFIER))
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(config) = env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
        {
            return Ok(config.join(APP_IDENTIFIER));
        }
        let home = env::var_os("HOME").context("HOME is unavailable")?;
        Ok(PathBuf::from(home).join(".config").join(APP_IDENTIFIER))
    }
}

pub(super) fn default_driver_package_dir(profile: &Path) -> Result<PathBuf> {
    // Explicit portable profiles keep their packages beside metadata. The
    // installed Linux profile follows Tauri's distinct XDG config/data roots.
    #[cfg(all(unix, not(target_os = "macos")))]
    let installed = default_config_dir()
        .ok()
        .and_then(|path| path.canonicalize().ok());
    #[cfg(all(unix, not(target_os = "macos")))]
    if profile
        .canonicalize()
        .ok()
        .zip(installed)
        .is_some_and(|(selected, installed)| selected == installed)
    {
        {
            let data = match env::var_os("XDG_DATA_HOME")
                .map(PathBuf::from)
                .filter(|path| path.is_absolute())
            {
                Some(data) => data,
                None => PathBuf::from(env::var_os("HOME").context("HOME is unavailable")?)
                    .join(".local/share"),
            };
            return Ok(data.join(APP_IDENTIFIER).join("database-drivers"));
        }
    }
    Ok(profile.join("database-drivers"))
}
