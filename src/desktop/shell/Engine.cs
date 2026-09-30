using System;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace AccountSwitch.Desktop
{
    /// <summary>
    /// The app server (engine\AccountSwitch-engine.exe --desktop): started hidden as a child
    /// process, stopped by closing its standard input so it ends its sign-in processes cleanly.
    /// </summary>
    internal sealed class Engine
    {
        private Process process;
        private bool stopping;
        public string Url { get; private set; }
        /// <summary>True when another server already used this data folder and we only showed it.</summary>
        public bool Attached { get; private set; }
        public event Action<int> Exited;

        public Task<string> Start()
        {
            stopping = false;
            Attached = false;
            var ready = new TaskCompletionSource<string>();
            string program = Paths.Engine;
            if (!File.Exists(program)) throw new FileNotFoundException("AccountSwitch server is missing", program);
            var start = new ProcessStartInfo(program, "--desktop")
            {
                WorkingDirectory = Path.GetDirectoryName(program),
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            start.EnvironmentVariables.Remove("NODE_OPTIONS");
            start.EnvironmentVariables.Remove("NODE_PATH");
            process = new Process { StartInfo = start, EnableRaisingEvents = true };
            string lastError = null;
            process.OutputDataReceived += (s, e) =>
            {
                var match = e.Data == null ? null : Regex.Match(e.Data, @"^AccountSwitch (launch|attached): (http://127\.0\.0\.1:\d+/\S*)$");
                if (match == null || !match.Success) return;
                Attached = match.Groups[1].Value == "attached";
                Url = match.Groups[2].Value;
                ready.TrySetResult(Url);
            };
            // The server's error output (crash traces) goes to logs\engine-stderr-YYYY-MM-DD.log.
            process.ErrorDataReceived += (s, e) =>
            {
                if (string.IsNullOrEmpty(e.Data)) return;
                lastError = e.Data;
                AppendError(e.Data);
            };
            var own = process;
            process.Exited += (s, e) =>
            {
                int code = SafeExitCode(own);
                if (!ready.Task.IsCompleted)
                {
                    ready.TrySetException(new Exception(lastError ?? "exit code " + code));
                    return;
                }
                // An attached server belongs to someone else; its end is not ours to handle.
                if (!stopping && !Attached && ReferenceEquals(own, process)) Exited?.Invoke(code);
            };
            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            return ready.Task;
        }

        private static readonly object ErrorLock = new object();
        private static void AppendError(string line)
        {
            try
            {
                string folder = Path.Combine(Paths.Data, "logs");
                lock (ErrorLock)
                {
                    Directory.CreateDirectory(folder);
                    File.AppendAllText(
                        Path.Combine(folder, "engine-stderr-" + DateTime.UtcNow.ToString("yyyy-MM-dd") + ".log"),
                        DateTime.UtcNow.ToString("o") + " " + line + Environment.NewLine);
                }
            }
            catch
            {
                // Logging never stops the program.
            }
        }

        public void Stop()
        {
            stopping = true;
            var current = process;
            if (current == null) return;
            try
            {
                if (!current.HasExited)
                {
                    current.StandardInput.Close();
                    if (!current.WaitForExit(15000)) current.Kill();
                }
            }
            catch (InvalidOperationException)
            {
                /* Already gone. */
            }
            process = null;
        }

        private static int SafeExitCode(Process value)
        {
            try { return value.ExitCode; } catch { return -1; }
        }
    }
}
