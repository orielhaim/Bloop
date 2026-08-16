use anyhow::{Context, Result, bail};
use cargo_metadata::{Message, MetadataCommand};
use std::{
    fs,
    io::{BufReader, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

fn main() -> Result<()> {
    let command = std::env::args().nth(1).unwrap_or_else(|| "plugins".into());

    match command.as_str() {
        "plugins" => build_plugins(false),
        "plugins-release" => build_plugins(true),
        other => bail!("unknown xtask command: {other}"),
    }
}

fn build_plugins(app_release: bool) -> Result<()> {
    let root = workspace_root()?;
    let plugins_dir = root.join("plugins");

    if !plugins_dir.exists() {
        bail!("plugins directory not found: {}", plugins_dir.display());
    }

    let output_profile = if app_release { "release" } else { "debug" };
    let runtime_plugins_dir = root.join("target").join(output_profile).join("plugins");

    fs::create_dir_all(&runtime_plugins_dir)?;

    for entry in fs::read_dir(&plugins_dir)? {
        let entry = entry?;
        let plugin_dir = entry.path();

        if !plugin_dir.is_dir() {
            continue;
        }

        let manifest = plugin_dir.join("Cargo.toml");

        if !manifest.exists() {
            continue;
        }

        let plugin_name = plugin_dir
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();

        println!("building plugin: {plugin_name}");

        let wasm = build_plugin(&root, &manifest)
            .with_context(|| format!("failed to build plugin {plugin_name}"))?;

        let destination_dir = runtime_plugins_dir.join(&plugin_name);
        fs::create_dir_all(&destination_dir)?;

        let destination = destination_dir.join("component.wasm");

        fs::copy(&wasm, &destination).with_context(|| {
            format!(
                "failed to copy {} -> {}",
                wasm.display(),
                destination.display()
            )
        })?;

        println!("  {} -> {}", wasm.display(), destination.display());
    }

    println!("all plugins built successfully");

    Ok(())
}

fn build_plugin(root: &Path, manifest: &Path) -> Result<PathBuf> {
    let mut child = Command::new("cargo")
        .current_dir(root)
        .args([
            "build",
            "--manifest-path",
            manifest.to_str().unwrap(),
            "--target",
            "wasm32-wasip2",
            "--release",
            "--message-format=json-render-diagnostics",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .context("failed to start cargo")?;

    let stdout = child.stdout.take().unwrap();
    let reader = BufReader::new(stdout);

    let mut wasm = None;

    for message in Message::parse_stream(reader) {
        match message? {
            Message::CompilerArtifact(artifact) => {
                for filename in artifact.filenames {
                    let path = filename.into_std_path_buf();

                    if path.extension().is_some_and(|ext| ext == "wasm") {
                        wasm = Some(path);
                    }
                }
            }

            Message::CompilerMessage(message) => {
                if let Some(rendered) = message.message.rendered {
                    print!("{rendered}");
                    std::io::stdout().flush()?;
                }
            }

            _ => {}
        }
    }

    let status = child.wait()?;

    if !status.success() {
        bail!("cargo build failed");
    }

    wasm.context("cargo succeeded but no .wasm artifact was produced")
}

fn workspace_root() -> Result<PathBuf> {
    let metadata = MetadataCommand::new()
        .no_deps()
        .exec()
        .context("failed to read cargo metadata")?;

    Ok(metadata.workspace_root.into_std_path_buf())
}
