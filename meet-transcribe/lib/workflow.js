// The two files that make a macOS Quick Action: Info.plist, which tells the
// Services system when to offer it, and document.wflow, the Automator workflow
// that runs one shell action.
//
// Both are generated rather than checked in as fixtures so the command can
// carry this checkout's absolute path. A malformed plist produces no error and
// no menu item, which is why test/workflow.test.js lints what this returns.

export const SERVICE_NAME = 'Transcribe with Whisper';
const BUNDLE_ID = 'dev.relay.meet-transcribe';

// A Quick Action runs under launchd with PATH=/usr/bin:/bin:/usr/sbin:/sbin —
// `launchctl getenv PATH` is empty, so there is nothing else to inherit.
// Writing node's absolute path covers node and nothing else: the pipeline
// shells out to whisper-cli, whisper, ffmpeg and ffprobe by name, and all four
// are invisible from that PATH. The symptom is "No Whisper found" from an
// action on a machine where whisper-cli runs fine in a terminal.
//
// These are prepended rather than discovered at install time on purpose. A
// discovered path goes stale the moment ffmpeg is installed afterwards; these
// three cover Homebrew on both prefixes and pipx, and are the same locations
// lib/runtime.js already searches for the model.
export const TOOL_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '$HOME/.local/bin'];

// Where a node symlink that outlives upgrades would be. Only the Homebrew
// prefixes: pipx's dir never holds node, and $HOME/.local/bin above is a shell
// literal, not a path this process could stat.
export const NODE_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'];

/**
 * The node path to bake into the action. process.execPath is fully resolved —
 * running Homebrew's bin/node reports Cellar/node/<version>/bin/node, and
 * `brew upgrade node` deletes that directory, breaking the action until the
 * installer is re-run (the same Cellar hazard lib/runtime.js documents for
 * models). So prefer a stable symlink, but only one that resolves to the very
 * binary running the installer: anything else would swap interpreters behind
 * the user's back, and execPath — stale-prone but correct — is the fallback.
 */
export function stableNodePath({ execPath, dirs = NODE_DIRS, realpath }) {
  let target;
  try {
    target = realpath(execPath);
  } catch {
    return execPath;
  }
  for (const dir of dirs) {
    const candidate = `${dir}/node`;
    try {
      if (realpath(candidate) === target) return candidate;
    } catch {
      // No node in this prefix.
    }
  }
  return execPath;
}

/**
 * The shell body the action runs. `$PATH` is kept on the end so anything
 * launchd does provide still resolves, and the two paths are quoted because a
 * checkout under a path with a space is otherwise split into two arguments.
 *
 * `language` is baked in for the same reason node's path is: a Quick Action has
 * no terminal to ask and no shell environment to read. Omitting it leaves
 * transcribe.js on auto-detect.
 */
export function buildCommand({ node, script, dirs = TOOL_DIRS, language = null }) {
  // Before "$@", which is the list of files Finder passes.
  const options = language ? ` --language ${language}` : '';
  return `export PATH="${dirs.join(':')}:$PATH"\n"${node}" "${script}"${options} "$@"\n`;
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

export const escapeXml = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

export function buildInfoPlist({ name = SERVICE_NAME, bundleId = BUNDLE_ID } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key><string>en</string>
	<key>CFBundleIdentifier</key><string>${escapeXml(bundleId)}</string>
	<key>CFBundleName</key><string>${escapeXml(name)}</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleShortVersionString</key><string>1.0</string>
	<key>NSServices</key>
	<array>
		<dict>
			<key>NSMenuItem</key>
			<dict><key>default</key><string>${escapeXml(name)}</string></dict>
			<key>NSMessage</key><string>runWorkflowAsService</string>
			<key>NSRequiredContext</key>
			<dict><key>NSApplicationIdentifier</key><string>com.apple.finder</string></dict>
			<key>NSSendFileTypes</key>
			<array>
				<string>public.audio</string>
				<string>public.movie</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
`;
}

export function buildDocumentWflow({ command }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AMApplicationBuild</key><string>528</string>
	<key>AMApplicationVersion</key><string>2.10</string>
	<key>AMDocumentVersion</key><string>2</string>
	<key>actions</key>
	<array>
		<dict>
			<key>action</key>
			<dict>
				<key>AMAccepts</key>
				<dict>
					<key>Container</key><string>List</string>
					<key>Optional</key><true/>
					<key>Types</key><array><string>com.apple.cocoa.string</string></array>
				</dict>
				<key>AMActionVersion</key><string>2.0.3</string>
				<key>AMApplication</key><array><string>Automator</string></array>
				<key>AMParameterProperties</key>
				<dict>
					<key>COMMAND_STRING</key><dict/>
					<key>CheckedForUserDefaultShell</key><dict/>
					<key>inputMethod</key><dict/>
					<key>shell</key><dict/>
					<key>source</key><dict/>
				</dict>
				<key>AMProvides</key>
				<dict>
					<key>Container</key><string>List</string>
					<key>Types</key><array><string>com.apple.cocoa.string</string></array>
				</dict>
				<key>ActionBundlePath</key><string>/System/Library/Automator/Run Shell Script.action</string>
				<key>ActionName</key><string>Run Shell Script</string>
				<key>ActionParameters</key>
				<dict>
					<key>COMMAND_STRING</key><string>${escapeXml(command)}</string>
					<key>CheckedForUserDefaultShell</key><true/>
					<key>inputMethod</key><integer>1</integer>
					<key>shell</key><string>/bin/zsh</string>
					<key>source</key><string></string>
				</dict>
				<key>BundleIdentifier</key><string>com.apple.Automator.RunShellScript</string>
				<key>CFBundleVersion</key><string>2.0.3</string>
				<key>CanShowSelectedItemsWhenRun</key><false/>
				<key>CanShowWhenRun</key><true/>
				<key>Category</key><array><string>AMCategoryUtilities</string></array>
				<key>Class Name</key><string>RunShellScriptAction</string>
				<key>InputUUID</key><string>0F1E2D3C-0001-4000-8000-000000000001</string>
				<key>Keywords</key><array><string>Shell</string></array>
				<key>OutputUUID</key><string>0F1E2D3C-0002-4000-8000-000000000002</string>
				<key>UUID</key><string>0F1E2D3C-0003-4000-8000-000000000003</string>
				<key>UnlocalizedApplications</key><array><string>Automator</string></array>
				<key>arguments</key><dict/>
				<key>isViewVisible</key><integer>1</integer>
				<key>location</key><string>309.000000:253.000000</string>
				<key>nibPath</key><string>/System/Library/Automator/Run Shell Script.action/Contents/Resources/Base.lproj/main.nib</string>
			</dict>
			<key>isViewVisible</key><integer>1</integer>
		</dict>
	</array>
	<key>connectors</key><dict/>
	<key>workflowMetaData</key>
	<dict>
		<key>presentationMode</key><integer>11</integer>
		<key>processesInput</key><integer>0</integer>
		<key>serviceApplicationBundleID</key><string>com.apple.finder</string>
		<key>serviceApplicationPath</key><string>/System/Library/CoreServices/Finder.app</string>
		<key>serviceInputTypeIdentifier</key><string>com.apple.Automator.fileSystemObject</string>
		<key>serviceOutputTypeIdentifier</key><string>com.apple.Automator.nothing</string>
		<key>workflowTypeIdentifier</key><string>com.apple.Automator.servicesMenu</string>
	</dict>
</dict>
</plist>
`;
}
