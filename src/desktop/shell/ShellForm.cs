using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace AccountSwitch.Desktop
{
    /// <summary>The program window: the AccountSwitch page in WebView2, without browser chrome.</summary>
    internal sealed class ShellForm : Form
    {
        private readonly ShellContext context;
        private readonly WebView2 view = new WebView2 { Dock = DockStyle.Fill };
        private readonly Label problem = new Label
        {
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleCenter,
            Font = new Font("Segoe UI", 11f),
            ForeColor = Color.FromArgb(160, 160, 160),
            Text = "AccountSwitch를 시작하는 중…",
        };
        private string origin;
        private string opened;
        private bool ready;
        private bool launching;

        public ShellForm(ShellContext context)
        {
            this.context = context;
            Text = "AccountSwitch";
            Icon = ShellContext.AppIcon;
            BackColor = Color.FromArgb(32, 33, 36);
            MinimumSize = new Size(480, 560);
            StartPosition = FormStartPosition.Manual;
            var saved = context.Settings.Window;
            var bounds = saved != null && saved.Length == 4 ? new Rectangle(saved[0], saved[1], saved[2], saved[3]) : Rectangle.Empty;
            if (bounds.Width >= MinimumSize.Width && bounds.Height >= MinimumSize.Height && Array.Exists(Screen.AllScreens, s => s.WorkingArea.IntersectsWith(bounds)))
                Bounds = bounds;
            else
            {
                var area = Screen.PrimaryScreen.WorkingArea;
                Size = new Size(Math.Min(760, area.Width - 80), Math.Min(960, area.Height - 80));
                Location = new Point(area.X + (area.Width - Width) / 2, area.Y + (area.Height - Height) / 2);
            }
            if (context.Settings.Maximized) WindowState = FormWindowState.Maximized;
            Controls.Add(view);
            Controls.Add(problem);
            view.Visible = false;
            _ = Initialize();
        }

        private async System.Threading.Tasks.Task Initialize()
        {
            try
            {
                // Browser data (the page's session cookie) lives with the user data, not the
                // install folder, which updates replace.
                var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Paths.Data, "webview"));
                await view.EnsureCoreWebView2Async(environment);
            }
            catch (Exception error)
            {
                ShowProblem("창을 표시하지 못했습니다. Microsoft Edge WebView2 런타임을 확인하세요. (" + error.Message + ")");
                return;
            }
            var core = view.CoreWebView2;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDevToolsEnabled = Environment.GetEnvironmentVariable("ACCOUNTSWITCH_DEVTOOLS") == "1";
            core.Settings.AreDefaultContextMenusEnabled = core.Settings.AreDevToolsEnabled;
            core.Settings.IsZoomControlEnabled = true;
            // The window shows only the local page; other pages (sign-in addresses) open in the
            // default browser.
            core.NewWindowRequested += (s, e) =>
            {
                e.Handled = true;
                ShellContext.OpenExternal(e.Uri);
            };
            core.NavigationStarting += (s, e) =>
            {
                if (origin == null || e.Uri == origin || e.Uri.StartsWith(origin + "/", StringComparison.Ordinal)) return;
                e.Cancel = true;
                ShellContext.OpenExternal(e.Uri);
            };
            core.WebMessageReceived += OnPageMessage;
            ready = true;
            if (opened != null) Navigate(opened);
        }

        /// <summary>A message from the page: only the app's own page, only what SPEC 4 names.</summary>
        private async void OnPageMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            if (!IsOwnPage(e.Source)) return;
            Dictionary<string, object> message;
            // An exception out of async void would end the program, so none may leave this method.
            try { message = new JavaScriptSerializer().DeserializeObject(e.WebMessageAsJson) as Dictionary<string, object>; }
            catch (Exception) { return; }
            if (message == null || !message.TryGetValue("type", out object type)) return;
            // launcher.open: the folder dialog, then the terminal (SPEC 4). launcher.pick: only the
            // folder dialog; the page has the engine open it in Paseo (SPEC 4.1). launcher.show-paseo:
            // the Paseo window to the front, when the engine had no agent to send it to.
            if ("launcher.show-paseo".Equals(type))
            {
                try { ShowPaseo(); } catch (Exception) { }
                return;
            }
            bool pick = "launcher.pick".Equals(type);
            if (!pick && !"launcher.open".Equals(type)) return;
            string provider = message.TryGetValue("provider", out object named) ? named as string : null;
            if (!pick && !CliLauncher.Knows(provider)) return;
            void Failed(string why)
            {
                var failed = new Dictionary<string, object> { ["type"] = "launcher.failed", ["reason"] = why };
                if (!pick) failed["provider"] = provider;
                PostToPage(failed);
            }
            if (launching)
            {
                Failed("BUSY");
                return;
            }
            launching = true;
            try
            {
                string reason = pick ? PickForPaseo() : await OpenTerminal(provider);
                if (reason != null) Failed(reason);
            }
            catch (Exception)
            {
                Failed("LAUNCH_FAILED");
            }
            finally
            {
                launching = false;
            }
        }

        /// <summary>The folder dialog, then the terminal. The failure reason, or null when it opened or was cancelled.</summary>
        private async System.Threading.Tasks.Task<string> OpenTerminal(string provider)
        {
            // Nothing to choose a folder for when it could not open anyway.
            if (CliLauncher.Find(provider, CliLauncher.CurrentPath()) == null) return "CLI_UNAVAILABLE";
            string folder;
            try
            {
                folder = FolderPicker.Pick(Handle, CliLauncher.Name(provider) + "를 열 폴더 선택", "이 폴더 열기");
            }
            catch (Exception)
            {
                return "DIALOG_FAILED";
            }
            if (folder == null) return null;
            return await System.Threading.Tasks.Task.Run(() => CliLauncher.Open(provider, folder));
        }

        /// <summary>
        /// The folder dialog for Paseo (SPEC 4.1): answers launcher.picked with the folder. The failure
        /// reason, or null when it answered or was cancelled.
        /// </summary>
        private string PickForPaseo()
        {
            string folder;
            try
            {
                folder = FolderPicker.Pick(Handle, "Paseo로 열 폴더 선택", "이 폴더 열기");
            }
            catch (Exception)
            {
                return "DIALOG_FAILED";
            }
            if (folder == null) return null;
            // This window holds the foreground right after the user's choice; let the Paseo window
            // the engine is about to show take it, or Windows keeps it behind.
            AllowSetForegroundWindow(AnyProcess);
            PostToPage(new Dictionary<string, object>
            {
                ["type"] = "launcher.picked",
                ["folder"] = folder,
            });
            return null;
        }

        /// <summary>
        /// Paseo's window to the front, restored if minimized, or Paseo started when it has none (SPEC 4.1). Started from the user's click
        /// on this window, which holds the foreground, so Windows lets it through.
        /// </summary>
        private static void ShowPaseo()
        {
            foreach (var process in System.Diagnostics.Process.GetProcessesByName("Paseo"))
            {
                using (process)
                {
                    IntPtr window = process.MainWindowHandle;
                    if (window == IntPtr.Zero) continue;
                    if (IsIconic(window)) ShowWindow(window, Restore);
                    SetForegroundWindow(window);
                    return;
                }
            }
            // No window: Paseo was quit while its daemon kept running (keepRunningAfterQuit, SPEC
            // 3.3), so the engine found it answering and started nothing. A first start opens one window.
            // The folders of PASEO_FOLDERS in the setup manifest, in its order.
            foreach (string folder in new[]
            {
                Environment.ExpandEnvironmentVariables(@"%LOCALAPPDATA%\Programs\Paseo"),
                Environment.ExpandEnvironmentVariables(@"%ProgramFiles%\Paseo"),
            })
            {
                string program = Path.Combine(folder, "Paseo.exe");
                if (!File.Exists(program)) continue;
                var start = new System.Diagnostics.ProcessStartInfo(program) { UseShellExecute = false, WorkingDirectory = folder };
                foreach (string name in new[] { "ELECTRON_RUN_AS_NODE", "ELECTRON_NO_ATTACH_CONSOLE", "PASEO_NODE_ENV" })
                    start.EnvironmentVariables.Remove(name);
                System.Diagnostics.Process.Start(start)?.Dispose();
                return;
            }
        }

        private const int Restore = 9; // SW_RESTORE

        [DllImport("user32.dll")]
        private static extern bool IsIconic(IntPtr window);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr window, int command);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr window);

        private const int AnyProcess = -1; // ASFW_ANY

        [DllImport("user32.dll")]
        private static extern bool AllowSetForegroundWindow(int processId);

        private bool IsOwnPage(string address) =>
            origin != null && address != null && (address == origin || address.StartsWith(origin + "/", StringComparison.Ordinal));

        private void PostToPage(Dictionary<string, object> message)
        {
            try
            {
                if (IsDisposed || view.CoreWebView2 == null || !IsOwnPage(view.CoreWebView2.Source)) return;
                view.CoreWebView2.PostWebMessageAsJson(new JavaScriptSerializer().Serialize(message));
            }
            catch (Exception)
            {
                // The window is closing; there is no page left to tell.
            }
        }

        /// <summary>Show the page (first time: the launch link that signs the window in).</summary>
        public void Open(string url)
        {
            if (opened != null && url == opened && view.Visible) return;
            opened = url;
            if (ready) Navigate(url);
        }

        private void Navigate(string url)
        {
            var uri = new Uri(url);
            origin = uri.GetLeftPart(UriPartial.Authority);
            problem.Visible = false;
            view.Visible = true;
            // After the first sign-in the session cookie is enough; keep the current page.
            if (view.Source == null || !view.Source.AbsoluteUri.StartsWith(origin, StringComparison.Ordinal))
                view.CoreWebView2.Navigate(url);
        }

        public void ShowProblem(string text)
        {
            problem.Text = text;
            problem.Visible = true;
            view.Visible = false;
            if (!Visible && !context.Quitting) Show();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            context.Settings.Maximized = WindowState == FormWindowState.Maximized;
            var bounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            context.Settings.Window = new[] { bounds.X, bounds.Y, bounds.Width, bounds.Height };
            try { context.Settings.Save(); } catch { /* Window placement is a convenience. */ }
            switch (QuitGuard.OnClose(e.CloseReason, context.Quitting, context.Settings.Background))
            {
                case CloseAction.HideToTray:
                    e.Cancel = true;
                    Hide();
                    context.Hidden();
                    return;
                case CloseAction.RequestQuit:
                    e.Cancel = true;
                    context.RequestQuit();
                    return;
            }
            base.OnFormClosing(e);
        }
    }
}
