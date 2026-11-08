using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace AccountSwitch.Desktop
{
    /// <summary>
    /// "Claude 열기" and "GPT 열기" (SPEC 4): a cmd.exe /K terminal in a folder, running the CLI.
    /// The same launch as src/core/launcher.ts, which has the tests and the browser fallback; change both.
    /// </summary>
    internal static class CliLauncher
    {
        private const string Claude = "claude-cli";
        private const string Codex = "codex-cli";
        private const string TitleVariable = "ACCOUNTSWITCH_LAUNCH_TITLE";
        private const string ProgramVariable = "ACCOUNTSWITCH_LAUNCH_PROGRAM";

        /// <summary>
        /// The whole command line, one fixed string, so nothing a folder is called can reach cmd's
        /// parser as a command. See LAUNCH_ARGUMENTS in src/core/launcher.ts for how it reads.
        /// </summary>
        internal const string Arguments =
            "/D /S /V:OFF /C \"start \"%" + TitleVariable + "%\" \"%ComSpec%\" /D /S /V:OFF /K ^\"^\"%^" + ProgramVariable + "%^\"^\"\"";

        private static readonly Regex LocalFolder = new Regex(@"^[A-Za-z]:[\\/][^<>:""|?*]*$");
        // subscriptionEnvironment in src/core/cli.ts, plus another session's marker: Claude Code
        // refuses to start when it thinks it is nested.
        private static readonly Regex NotInheritedByClaude = new Regex(
            "^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_CONFIG_DIR$|CLAUDE_AGENT_SDK_|CLAUDE_ENV_FILE$|CLAUDECODE$)",
            RegexOptions.IgnoreCase);
        // codexEnvironment in src/core/cli.ts, plus the same marker as above.
        private static readonly Regex NotInheritedByCodex = new Regex(
            "^(OPENAI_|CODEX_API_KEY$|CODEX_ACCESS_TOKEN$|CODEX_AUTH_|CODEX_THREAD_ID$|CODEX_INTERNAL_|CODEX_HOME$|CODEX_CONFIG_|CLAUDECODE$)",
            RegexOptions.IgnoreCase);
        // codexPackageRoot in src/core/launcher.ts.
        private static readonly Regex CodexPackage = new Regex(
            @"^(.*[\\/]node_modules[\\/]@openai[\\/]codex)[\\/]node_modules[\\/]",
            RegexOptions.IgnoreCase);

        public static bool Knows(string provider) => provider == Claude || provider == Codex;

        /// <summary>What the window title and the folder dialog call it.</summary>
        public static string Name(string provider) => provider == Codex ? "Codex" : "Claude Code";

        /// <summary>The failure reason (SPEC 4) when this folder cannot be used, else null.</summary>
        public static string FolderProblem(string folder)
        {
            if (string.IsNullOrEmpty(folder) || folder.Any(value => value < ' ')) return "FOLDER_INVALID";
            // cmd cannot start in a UNC path: it would silently run in the Windows folder instead.
            if (folder.Length >= 2 && IsSeparator(folder[0]) && IsSeparator(folder[1])) return "FOLDER_NETWORK";
            if (!LocalFolder.IsMatch(folder)) return "FOLDER_INVALID";
            return Directory.Exists(folder) ? null : "FOLDER_NOT_FOUND";
        }

        private static bool IsSeparator(char value) => value == '\\' || value == '/';

        /// <summary>
        /// The search list the terminal should have: this program may have started before an
        /// installer changed the PATH, so the registry comes first, then what it already had.
        /// </summary>
        public static string CurrentPath()
        {
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var parts = new List<string>();
            foreach (var value in new[]
            {
                Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.Machine),
                Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.User),
                Environment.GetEnvironmentVariable("Path"),
            })
                foreach (var part in (value ?? "").Split(';'))
                {
                    string entry = part.Trim();
                    if (entry.Length > 0 && seen.Add(entry.TrimEnd('\\'))) parts.Add(entry);
                }
            return string.Join(";", parts);
        }

        /// <summary>The program as executable() in src/core/cli.ts finds it, else null.</summary>
        public static string Find(string provider, string path) => provider == Codex ? FindCodex(path) : FindClaude(path);

        private static string FindClaude(string path)
        {
            string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            string roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            var candidates = new List<string>
            {
                Environment.GetEnvironmentVariable("ACCOUNTSWITCH_CLAUDE_PATH"),
                Path.Combine(home, ".local", "bin", "claude.exe"),
                Path.Combine(roaming, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"),
            };
            candidates.AddRange((path ?? "").Split(';').Select(folder => InFolder(folder, "claude.exe")));
            return candidates.FirstOrDefault(file => !string.IsNullOrEmpty(file) && file.IndexOf('"') < 0 && File.Exists(file));
        }

        private static string FindCodex(string path)
        {
            string roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var candidates = new List<string>
            {
                Environment.GetEnvironmentVariable("ACCOUNTSWITCH_CODEX_PATH"),
                Path.Combine(roaming, "npm", "node_modules", "@openai", "codex", "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe"),
                NewestDesktopCodex(Path.Combine(local, "OpenAI", "Codex", "bin")),
            };
            candidates.AddRange((path ?? "").Split(';').Select(folder => InFolder(folder, "codex.exe")));
            return candidates.FirstOrDefault(file => !string.IsNullOrEmpty(file) && file.IndexOf('"') < 0 && File.Exists(file));
        }

        private static string NewestDesktopCodex(string folder)
        {
            try
            {
                return Directory.GetDirectories(folder)
                    .Where(version => Regex.IsMatch(Path.GetFileName(version), "^[a-zA-Z0-9._-]+$"))
                    .Take(200)
                    .Select(version => Path.Combine(version, "codex.exe"))
                    .Where(File.Exists)
                    .OrderByDescending(File.GetLastWriteTimeUtc)
                    .FirstOrDefault();
            }
            catch (Exception error) when (error is IOException || error is UnauthorizedAccessException)
            {
                return null;
            }
        }

        private static string InFolder(string folder, string name)
        {
            try { return folder.Length > 0 ? Path.Combine(folder, name) : null; }
            catch (ArgumentException) { return null; }
        }

        /// <summary>The hidden cmd that opens the terminal; everything that varies is outside its command line.</summary>
        public static ProcessStartInfo Prepare(string provider, string folder, string program, string path)
        {
            string processor = Path.Combine(Environment.SystemDirectory, "cmd.exe");
            var start = new ProcessStartInfo(processor, Arguments)
            {
                WorkingDirectory = folder,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            var environment = start.EnvironmentVariables;
            Regex notInherited = provider == Codex ? NotInheritedByCodex : NotInheritedByClaude;
            foreach (var key in environment.Keys.Cast<string>().Where(key => notInherited.IsMatch(key)).ToList())
                environment.Remove(key);
            environment["PATH"] = path;
            environment["ComSpec"] = processor;
            environment[TitleVariable] = Title(provider, folder);
            environment[ProgramVariable] = program;
            if (provider == Codex)
            {
                // What npm's wrapper script would set; the binary finds its own tools through these.
                Match package = CodexPackage.Match(program);
                if (package.Success)
                {
                    environment["CODEX_MANAGED_BY_NPM"] = "1";
                    environment["CODEX_MANAGED_PACKAGE_ROOT"] = package.Groups[1].Value;
                }
            }
            else
            {
                // Claude Code would otherwise replace the window title with its own.
                environment["CLAUDE_CODE_DISABLE_TERMINAL_TITLE"] = "1";
            }
            return start;
        }

        /// <summary>Claude Code - folder name; a drive root has no name of its own.</summary>
        public static string Title(string provider, string folder)
        {
            string name = Path.GetFileName(folder.TrimEnd('\\', '/'));
            return Name(provider) + " - " + (string.IsNullOrEmpty(name) ? folder : name);
        }

        /// <summary>The full path without a trailing separator, except a drive root's.</summary>
        public static string Normalize(string folder)
        {
            string full = Path.GetFullPath(folder);
            string root = Path.GetPathRoot(full);
            return full.Length > root.Length ? full.TrimEnd('\\') : full;
        }

        /// <summary>Open the terminal. Returns the failure reason, or null when it opened.</summary>
        public static string Open(string provider, string folder)
        {
            string problem = FolderProblem(folder);
            if (problem != null) return problem;
            string path = CurrentPath();
            string program = Find(provider, path);
            if (program == null) return "CLI_UNAVAILABLE";
            try
            {
                using (var process = Process.Start(Prepare(provider, Normalize(folder), program, path)))
                {
                    // `start` returns as soon as the terminal has its window; the hidden cmd ends with it.
                    if (process.WaitForExit(10000)) return process.ExitCode == 0 ? null : "LAUNCH_FAILED";
                    process.Kill();
                    return "LAUNCH_FAILED";
                }
            }
            catch (Exception error) when (error is System.ComponentModel.Win32Exception || error is InvalidOperationException || error is IOException || error is ArgumentException || error is NotSupportedException)
            {
                return "LAUNCH_FAILED";
            }
        }
    }
}
