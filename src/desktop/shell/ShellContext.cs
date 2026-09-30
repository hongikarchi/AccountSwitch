using System;
using System.Diagnostics;
using System.Drawing;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace AccountSwitch.Desktop
{
    /// <summary>Tray icon, server, window and updates for one running AccountSwitch program.</summary>
    internal sealed class ShellContext : ApplicationContext
    {
        private readonly NotifyIcon tray;
        private readonly ToolStripMenuItem updateItem;
        private readonly ToolStripMenuItem autostartItem;
        private readonly ToolStripMenuItem backgroundItem;
        private readonly Engine engine = new Engine();
        private readonly EventWaitHandle showSignal;
        private readonly EventWaitHandle quitSignal;
        private readonly SynchronizationContext ui;
        private readonly System.Windows.Forms.Timer updateTimer = new System.Windows.Forms.Timer();
        private ShellForm form;
        private int restarts;
        public DesktopSettings Settings { get; }
        public Updater Updater { get; }
        public bool Quitting { get; private set; }
        public static readonly Icon AppIcon = LoadIcon();

        public ShellContext(bool background)
        {
            WindowsFormsSynchronizationContext.AutoInstall = true;
            ui = new WindowsFormsSynchronizationContext();
            SynchronizationContext.SetSynchronizationContext(ui);
            Settings = DesktopSettings.Load();
            try { Settings.ApplyAutostart(Paths.Launcher); } catch { /* Policy may block the Run key. */ }
            string source = Environment.GetEnvironmentVariable("ACCOUNTSWITCH_UPDATE_SOURCE");
            Updater = new Updater(string.IsNullOrWhiteSpace(source) ? Settings.UpdateSource : source);
            Updater.Changed += () => ui.Post(_ => OnUpdateChanged(), null);

            var menu = new ContextMenuStrip();
            var open = menu.Items.Add("AccountSwitch 열기", null, (s, e) => ShowWindow());
            open.Font = new Font(open.Font, FontStyle.Bold);
            menu.Items.Add(new ToolStripSeparator());
            autostartItem = new ToolStripMenuItem("Windows 시작 시 실행", null, (s, e) => SetOption(autostart: !Settings.Autostart));
            backgroundItem = new ToolStripMenuItem("창을 닫아도 트레이에서 실행", null, (s, e) => SetOption(background: !Settings.Background));
            menu.Items.Add(autostartItem);
            menu.Items.Add(backgroundItem);
            menu.Items.Add(new ToolStripSeparator());
            updateItem = new ToolStripMenuItem("업데이트 확인", null, (s, e) => OnUpdateClick());
            menu.Items.Add(updateItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("종료", null, (s, e) => Quit());
            tray = new NotifyIcon { Icon = AppIcon, Text = "AccountSwitch", ContextMenuStrip = menu, Visible = true };
            tray.DoubleClick += (s, e) => ShowWindow();
            ShowOptions();
            OnUpdateChanged();

            showSignal = new EventWaitHandle(false, EventResetMode.AutoReset, Program.ShowEventName);
            new Thread(() =>
            {
                while (showSignal.WaitOne())
                {
                    if (Quitting) return;
                    ui.Post(_ => ShowWindow(), null);
                }
            }) { IsBackground = true }.Start();
            quitSignal = new EventWaitHandle(false, EventResetMode.AutoReset, Program.QuitEventName);
            new Thread(() =>
            {
                if (quitSignal.WaitOne() && !Quitting) ui.Post(_ => Quit(), null);
            }) { IsBackground = true }.Start();

            engine.Exited += code => ui.Post(_ => OnEngineExited(code), null);
            form = new ShellForm(this);
            if (!background) form.Show();
            _ = StartEngine();
            // Check for updates shortly after start and every six hours.
            updateTimer.Interval = 60_000;
            updateTimer.Tick += (s, e) =>
            {
                updateTimer.Interval = 6 * 60 * 60_000;
                _ = Updater.Check();
            };
            updateTimer.Start();
        }

        private async Task StartEngine()
        {
            try
            {
                string url = await engine.Start();
                form.Open(url);
            }
            catch (Exception error)
            {
                form.ShowProblem("AccountSwitch 서버를 시작하지 못했습니다: " + error.Message);
            }
        }

        private void OnEngineExited(int code)
        {
            if (Quitting) return;
            // Restart a crashed server a few times; accounts and settings are on disk.
            if (++restarts <= 3)
            {
                form.ShowProblem("AccountSwitch 서버가 종료되어 다시 시작하는 중입니다…");
                _ = StartEngine();
                return;
            }
            form.ShowProblem("AccountSwitch 서버가 계속 종료됩니다 (코드 " + code + "). 프로그램을 다시 실행하세요.");
        }

        public void ShowWindow()
        {
            if (Quitting) return;
            if (form.IsDisposed) form = new ShellForm(this);
            if (!form.Visible) form.Show();
            if (form.WindowState == FormWindowState.Minimized) form.WindowState = Settings.Maximized ? FormWindowState.Maximized : FormWindowState.Normal;
            form.Activate();
            if (engine.Url != null) form.Open(engine.Url);
        }

        /// <summary>The window closed with background mode on: keep running in the tray.</summary>
        public void Hidden()
        {
            if (Settings.TrayHintShown) return;
            Settings.TrayHintShown = true;
            Settings.Save();
            tray.ShowBalloonTip(5000, "AccountSwitch", "창을 닫아도 트레이에서 계속 실행됩니다. 끝내려면 트레이 메뉴의 종료를 누르세요.", ToolTipIcon.Info);
        }

        private void SetOption(bool? autostart = null, bool? background = null)
        {
            if (autostart.HasValue) Settings.Autostart = autostart.Value;
            if (background.HasValue) Settings.Background = background.Value;
            try
            {
                Settings.Save();
                Settings.ApplyAutostart(Paths.Launcher);
            }
            catch (Exception error)
            {
                tray.ShowBalloonTip(5000, "AccountSwitch", "설정을 저장하지 못했습니다: " + error.Message, ToolTipIcon.Warning);
            }
            ShowOptions();
        }

        private void ShowOptions()
        {
            autostartItem.Checked = Settings.Autostart;
            backgroundItem.Checked = Settings.Background;
        }

        public void Quit(bool applyUpdate = false)
        {
            if (Quitting) return;
            Quitting = true;
            updateTimer.Stop();
            tray.Visible = false;
            try { form?.Close(); } catch { /* Closing anyway. */ }
            if (!engine.Attached) engine.Stop();
            showSignal.Set();
            if (applyUpdate) Updater.ApplyAndRestart();
            else Updater.ApplyAtExit();
            ExitThread();
        }

        private void OnUpdateClick()
        {
            if (Updater.State == "ready") Quit(true);
            else _ = Updater.Check();
        }

        private void OnUpdateChanged()
        {
            switch (Updater.State)
            {
                case "ready":
                    updateItem.Text = "재시작하여 업데이트 (" + Updater.Available + ")";
                    updateItem.Enabled = true;
                    tray.ShowBalloonTip(5000, "AccountSwitch 업데이트 준비됨", Updater.Available + " 버전을 설치할 수 있습니다. 종료하면 적용됩니다.", ToolTipIcon.Info);
                    break;
                case "checking": updateItem.Text = "업데이트 확인 중…"; updateItem.Enabled = false; break;
                case "downloading": updateItem.Text = "업데이트 내려받는 중 (" + Updater.Available + ")…"; updateItem.Enabled = false; break;
                case "current": updateItem.Text = "최신 버전 " + Paths.Version; updateItem.Enabled = true; break;
                case "unavailable": updateItem.Text = "업데이트 없음 (설치본 아님)"; updateItem.Enabled = false; break;
                case "error": updateItem.Text = "업데이트 확인 실패 · 다시 시도"; updateItem.Enabled = true; break;
                default: updateItem.Text = "업데이트 확인"; updateItem.Enabled = true; break;
            }
        }

        public static void OpenExternal(string url)
        {
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != "https" && uri.Scheme != "http")) return;
            try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); } catch { /* No browser. */ }
        }

        private static Icon LoadIcon()
        {
            try { return Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application; }
            catch { return SystemIcons.Application; }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                tray.Dispose();
                showSignal.Dispose();
                quitSignal.Dispose();
                updateTimer.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
