use super::control::writer_allowed;
#[cfg(any(windows, target_os = "linux"))]
use super::process::hide_process;
use super::state::SqliteBackupScheduleState;
use sha2::{Digest, Sha256};
use std::path::Path;
use std::time::{Duration, Instant};

fn registration_id(data_dir: &Path) -> String {
    let digest = Sha256::digest(data_dir.to_string_lossy().as_bytes());
    format!("oxide-backup-{:x}", digest)[..29].to_string()
}

#[cfg(any(windows, target_os = "macos", test))]
fn xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(any(windows, test))]
fn windows_arg(value: &str) -> String {
    let mut result = String::from("\"");
    let mut slashes = 0;
    for character in value.chars() {
        if character == '\\' {
            slashes += 1;
            continue;
        }
        if character == '"' {
            result.push_str(&"\\".repeat(slashes * 2 + 1));
        } else {
            result.push_str(&"\\".repeat(slashes));
        }
        result.push(character);
        slashes = 0;
    }
    result.push_str(&"\\".repeat(slashes * 2));
    result.push('"');
    result
}

#[cfg(any(windows, test))]
fn windows_task(executable: &str, data_dir: &str, config_dir: &str, user: &str) -> String {
    let arguments = format!(
        "--backup-worker --activate --data-dir {} --config-dir {}",
        windows_arg(data_dir),
        windows_arg(config_dir)
    );
    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<Triggers><LogonTrigger><Enabled>true</Enabled><UserId>{user}</UserId></LogonTrigger></Triggers>
<Principals><Principal id="BackupUser"><UserId>{user}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><ExecutionTimeLimit>PT0S</ExecutionTimeLimit></Settings>
<Actions Context="BackupUser"><Exec><Command>{executable}</Command><Arguments>{arguments}</Arguments></Exec></Actions></Task>
"#,
        user = xml(user),
        executable = xml(executable),
        arguments = xml(&arguments)
    )
}

#[cfg(any(windows, test))]
fn windows_task_bytes(contents: &str) -> Vec<u8> {
    std::iter::once(0xfeff_u16)
        .chain(contents.encode_utf16())
        .flat_map(u16::to_le_bytes)
        .collect()
}

#[cfg(any(target_os = "linux", test))]
fn systemd_arg(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('%', "%%")
            .replace('$', "$$")
    )
}

#[cfg(any(target_os = "linux", test))]
fn linux_service(executable: &str, data_dir: &str, config_dir: &str) -> String {
    format!("[Unit]\nDescription=OxideStudio background SQLite backups\n\n[Service]\nType=simple\nExecStart={} --backup-worker --activate --data-dir {} --config-dir {}\nRestart=on-failure\nRestartSec=30\n\n[Install]\nWantedBy=default.target\n", systemd_arg(executable), systemd_arg(data_dir), systemd_arg(config_dir))
}

#[cfg(any(target_os = "macos", test))]
fn mac_agent(id: &str, executable: &str, data_dir: &str, config_dir: &str) -> String {
    format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<plist version=\"1.0\"><dict><key>Label</key><string>{}</string><key>ProgramArguments</key><array><string>{}</string><string>--backup-worker</string><string>--activate</string><string>--data-dir</string><string>{}</string><string>--config-dir</string><string>{}</string></array><key>RunAtLoad</key><true/><key>ProcessType</key><string>Background</string></dict></plist>\n", xml(id), xml(executable), xml(data_dir), xml(config_dir))
}

#[cfg(any(windows, target_os = "linux"))]
fn run_registration_command(program: &str, args: &[&std::ffi::OsStr]) -> Result<(), String> {
    let mut command = std::process::Command::new(program);
    command.args(args);
    hide_process(&mut command);
    let mut child = command
        .spawn()
        .map_err(|_| "Cannot access the current user's backup startup manager".to_string())?;
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(_)) => {
                return Err(
                    "Cannot update background backup startup for the current user".to_string(),
                )
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("The backup startup manager did not finish".to_string());
            }
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn install_startup_file(path: &Path, contents: &str, enabled: bool) -> Result<(), String> {
    if enabled {
        crate::core::private_file::create_private_directory(
            path.parent().ok_or("Invalid backup startup path")?,
        )
        .map_err(|_| "Cannot create the user's backup startup directory")?;
        crate::core::private_file::replace_private_file(
            path,
            contents.as_bytes(),
            "sqlite-backup-startup",
        )
        .map_err(|_| "Cannot save the user's backup startup entry".to_string())
    } else {
        match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err("Cannot remove the user's backup startup entry".to_string()),
        }
    }
}

pub(super) async fn set_autostart(
    state: &SqliteBackupScheduleState,
    enabled: bool,
) -> Result<(), String> {
    let data_dir = state
        .root()
        .parent()
        .ok_or("Invalid backup profile directory")?
        .to_path_buf();
    let config_dir = state.config_dir.clone();
    tokio::task::spawn_blocking(move || {
        let executable =
            std::env::current_exe().map_err(|_| "Cannot locate the backup worker executable")?;
        let id = registration_id(&data_dir);
        for path in [&executable, &data_dir, &config_dir] {
            if path
                .to_str()
                .is_none_or(|path| path.chars().any(char::is_control))
            {
                return Err(
                    "Backup startup paths must contain valid text without control characters"
                        .to_string(),
                );
            }
        }
        #[cfg(windows)]
        {
            let task_name = format!("OxideStudio-{id}");
            if enabled {
                let username = std::env::var("USERNAME")
                    .map_err(|_| "Cannot identify the signed-in Windows backup user")?;
                let domain = std::env::var("USERDOMAIN")
                    .map_err(|_| "Cannot identify the signed-in Windows backup domain")?;
                let user = format!("{domain}\\{username}");
                let contents = windows_task(
                    executable.to_str().unwrap(),
                    data_dir.to_str().unwrap(),
                    config_dir.to_str().unwrap(),
                    &user,
                );
                let mut file = tempfile::Builder::new()
                    .prefix("oxide-backup-task-")
                    .suffix(".xml")
                    .tempfile()
                    .map_err(|_| "Cannot prepare the user's backup startup task")?;
                use std::io::Write;
                file.write_all(&windows_task_bytes(&contents))
                    .map_err(|_| "Cannot prepare the backup startup task")?;
                file.flush()
                    .map_err(|_| "Cannot flush the backup startup task")?;
                run_registration_command(
                    "schtasks.exe",
                    &[
                        "/Create".as_ref(),
                        "/TN".as_ref(),
                        task_name.as_ref(),
                        "/XML".as_ref(),
                        file.path().as_os_str(),
                        "/F".as_ref(),
                    ],
                )
            } else {
                run_registration_command(
                    "schtasks.exe",
                    &[
                        "/Delete".as_ref(),
                        "/TN".as_ref(),
                        task_name.as_ref(),
                        "/F".as_ref(),
                    ],
                )
            }
        }
        #[cfg(target_os = "linux")]
        {
            let config_home = std::env::var_os("XDG_CONFIG_HOME")
                .map(std::path::PathBuf::from)
                .filter(|path| path.is_absolute())
                .or_else(|| {
                    std::env::var_os("HOME")
                        .map(|home| std::path::PathBuf::from(home).join(".config"))
                })
                .ok_or("Cannot locate the user's startup configuration")?;
            let unit_name = format!("{id}.service");
            let path = config_home.join("systemd/user").join(&unit_name);
            let contents = linux_service(
                executable.to_str().unwrap(),
                data_dir.to_str().unwrap(),
                config_dir.to_str().unwrap(),
            );
            if enabled {
                install_startup_file(&path, &contents, true)?;
            }
            run_registration_command(
                "systemctl",
                &[
                    "--user".as_ref(),
                    if enabled { "enable" } else { "disable" }.as_ref(),
                    unit_name.as_ref(),
                ],
            )?;
            if !enabled {
                install_startup_file(&path, &contents, false)?;
            }
            run_registration_command("systemctl", &["--user".as_ref(), "daemon-reload".as_ref()])
        }
        #[cfg(target_os = "macos")]
        {
            let home = std::env::var_os("HOME")
                .ok_or("Cannot locate the user's LaunchAgents directory")?;
            let path = std::path::PathBuf::from(home)
                .join("Library/LaunchAgents")
                .join(format!("{id}.plist"));
            install_startup_file(
                &path,
                &mac_agent(
                    &id,
                    executable.to_str().unwrap(),
                    data_dir.to_str().unwrap(),
                    config_dir.to_str().unwrap(),
                ),
                enabled,
            )
        }
        #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
        {
            let _ = (id, enabled);
            Err("Background backup startup is not supported on this platform".to_string())
        }
    })
    .await
    .map_err(|_| "Cannot update backup startup settings".to_string())?
}

/// Called only after the installer has observed worker process exit and holds
/// the launch/leader leases. A stopped systemd unit cannot retry its old image.
pub(super) async fn suspend_autostart_for_update(
    state: &SqliteBackupScheduleState,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let id = registration_id(
            state
                .root()
                .parent()
                .ok_or("Invalid backup profile directory")?,
        );
        tokio::task::spawn_blocking(move || {
            run_registration_command(
                "systemctl",
                &[
                    "--user".as_ref(),
                    "stop".as_ref(),
                    format!("{id}.service").as_ref(),
                ],
            )
        })
        .await
        .map_err(|_| "Cannot suspend backup startup for the update".to_string())??;
    }
    set_autostart(state, false).await
}

pub(super) async fn set_background_enabled(
    state: &SqliteBackupScheduleState,
    enabled: bool,
) -> Result<(), String> {
    let _lease = state.lock_startup().await?;
    let previous = {
        let data = state.lock_data().await?;
        writer_allowed(state.root(), &state.config_dir, None)?;
        data.background_enabled
    };
    set_autostart(state, enabled).await?;
    let saved = async {
        let mut data = state.lock_data().await?;
        data.background_enabled = enabled;
        state.persist(&data)
    }
    .await;
    if let Err(error) = saved {
        if previous != enabled {
            let _ = set_autostart(state, previous).await;
        }
        return Err(error);
    }
    Ok(())
}

pub(super) async fn refresh_autostart(state: &SqliteBackupScheduleState) -> Result<(), String> {
    let _lease = state.lock_startup().await?;
    let enabled = {
        let data = state.lock_data().await?;
        writer_allowed(state.root(), &state.config_dir, None)?;
        data.background_enabled
    };
    if enabled {
        set_autostart(state, true).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{linux_service, mac_agent, registration_id, windows_task, windows_task_bytes};
    use std::path::Path;
    #[test]
    fn startup_specs_preserve_arguments_and_current_user_scope() {
        let windows = windows_task(
            "C:\\Program Files\\Oxide & Studio\\oxide.exe",
            "C:\\Users\\测试\\data\\",
            "C:\\Users\\a\\config",
            "DOMAIN\\tester",
        );
        assert!(windows.contains(
            "<LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel>"
        ));
        assert!(windows.contains("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>"));
        assert!(windows.contains("Oxide &amp; Studio"));
        assert!(windows.contains("&quot;C:\\Users\\测试\\data\\\\&quot;"));
        assert!(!windows.contains("SYSTEM"));
        assert!(windows_task_bytes(&windows).starts_with(&[0xff, 0xfe]));
        let linux = linux_service(
            "/opt/Oxide Studio/app",
            "/home/a/50% $data",
            "/home/a/config",
        );
        assert!(linux.contains("\"/home/a/50%% $$data\""));
        assert!(linux.contains("WantedBy=default.target"));
        let mac = mac_agent(
            "oxide-test",
            "/Apps/Oxide & Studio",
            "/Users/a/data",
            "/Users/a/config",
        );
        assert!(mac.contains("Oxide &amp; Studio</string>"));
        assert!(mac.contains("<key>RunAtLoad</key><true/>"));
        assert!(!mac.contains("KeepAlive"));
        assert_eq!(
            registration_id(Path::new("profile-a")),
            registration_id(Path::new("profile-a"))
        );
        assert_ne!(
            registration_id(Path::new("profile-a")),
            registration_id(Path::new("profile-b"))
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_task_xml_is_accepted_by_the_os_without_registering_a_task() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("task.xml");
        let user = format!(
            "{}\\{}",
            std::env::var("USERDOMAIN").unwrap(),
            std::env::var("USERNAME").unwrap()
        );
        let contents = windows_task(
            std::env::current_exe().unwrap().to_str().unwrap(),
            directory.path().to_str().unwrap(),
            directory.path().to_str().unwrap(),
            &user,
        );
        std::fs::write(&path, windows_task_bytes(&contents)).unwrap();
        // TASK_VALIDATE_ONLY (0x1) checks XML and does not create/update a task:
        // https://learn.microsoft.com/windows/win32/api/taskschd/ne-taskschd-task_creation
        let script = "$ErrorActionPreference='Stop'; $service=New-Object -ComObject Schedule.Service; $service.Connect(); $folder=$service.GetFolder('\\'); $xml=[IO.File]::ReadAllText($env:OXIDE_BACKUP_VALIDATE_XML); $null=$folder.RegisterTask(('OxideStudio-Validate-'+[Guid]::NewGuid().ToString()),$xml,1,$null,$null,3,$null)";
        let mut command = std::process::Command::new("powershell.exe");
        command
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .env("OXIDE_BACKUP_VALIDATE_XML", path);
        super::hide_process(&mut command);
        command
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        let mut child = command.spawn().unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while child.try_wait().unwrap().is_none() {
            if std::time::Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                panic!("Windows task XML validation timed out");
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
