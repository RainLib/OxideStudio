// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args = std::env::args_os().skip(1).collect::<Vec<_>>();
    if args.iter().any(|arg| arg == "--backup-worker") {
        if let Err(error) =
            oxide_studio_lib::commands::sqlite_backup_schedule::run_backup_worker_from_args(args)
        {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    oxide_studio_lib::run()
}
